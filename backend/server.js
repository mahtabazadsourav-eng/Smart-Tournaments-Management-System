require('dotenv').config({ path: require('path').resolve(__dirname, '.env') });

const express = require('express');
const cors = require('cors');
const db = require('./config/db');
const { verifyToken, authorizeRole } = require('./middleware/auth');

const app = express();

app.use(cors());
app.use(express.json());

// User routes
app.use('/api/users', require('./routes/users'));

app.get('/', (req, res) => {
    res.send('Smart Tournament Planner Backend is Running!');
});
// Tournament routes
app.use('/api/tournaments', require('./routes/tournaments'));
app.use('/api/teams', require('./routes/teams'));
app.use('/api/players', require('./routes/players'));
app.use('/api/venues', require('./routes/venues'));
app.use('/api/venue-availability', require('./routes/venueAvailability'));
app.use('/api/fixtures', require('./routes/fixtures'));
// Protected Captain Dashboard
app.get(
    '/api/captain/dashboard',
    verifyToken,
    authorizeRole('TEAM_CAPTAIN_PLAYER'),
    (req, res) => {
        res.json({
            message: 'Welcome to Captain Dashboard!',
            user: req.user
        });
    }
);

const PORT = Number(process.env.PORT) || 5000;

if (!process.env.JWT_SECRET) {
    console.error('JWT_SECRET is missing. Set it in backend/.env before starting the API.');
    process.exit(1);
}

db.getConnection((err, connection) => {
    if (err) {
        console.error('MySQL connection failed. Check that MySQL is running and backend/.env is correct:', err.message);
        process.exit(1);
    }
    connection.release();
    console.log('MySQL Database Connected Successfully!');
    const ensureColumn = (column, definition, next) => {
        db.query(`SHOW COLUMNS FROM team_players LIKE '${column}'`, (schemaErr, columns) => {
            if (schemaErr) {
                console.error(`Could not check team_players.${column}:`, schemaErr.message);
                process.exit(1);
            }
            if (columns.length) return next();
            db.query(`ALTER TABLE team_players ADD COLUMN ${column} ${definition}`, (migrationErr) => {
                if (migrationErr) {
                    console.error(`Could not add team_players.${column}:`, migrationErr.message);
                    process.exit(1);
                }
                console.log(`Added team_players.${column}.`);
                next();
            });
        });
    };
    db.query("ALTER TABLE users MODIFY role ENUM('ADMIN','ORGANIZER','VENUE_COORDINATOR','TEAM_CAPTAIN_PLAYER','PLAYER') NOT NULL DEFAULT 'TEAM_CAPTAIN_PLAYER'", (roleMigrationErr) => {
        if (roleMigrationErr) {
            console.error('Could not enable player accounts in users.role:', roleMigrationErr.message);
            process.exit(1);
        }
    ensureColumn('email', 'VARCHAR(150) DEFAULT NULL', () => {
        db.query('ALTER TABLE team_players MODIFY email VARCHAR(150) DEFAULT NULL', (emailMigrationErr) => {
            if (emailMigrationErr) {
                console.error('Could not make team_players.email optional:', emailMigrationErr.message);
                process.exit(1);
            }
            ensureColumn('team_role', "ENUM('PLAYER','CAPTAIN','VICE_CAPTAIN') NOT NULL DEFAULT 'PLAYER'", () => {
            db.query(
                `UPDATE team_players tp
                 JOIN users ON users.id = tp.user_id
                 LEFT JOIN teams ON teams.id = tp.team_id
                 SET tp.email = COALESCE(tp.email, users.email),
                     tp.team_role = CASE
                       WHEN teams.captain_id = tp.user_id THEN 'CAPTAIN'
                       ELSE tp.team_role
                     END
                 WHERE tp.user_id IS NOT NULL AND
                       (tp.email IS NULL OR teams.captain_id = tp.user_id)`,
                (backfillErr) => {
                    if (backfillErr) {
                        console.error('Could not sync existing team captains:', backfillErr.message);
                        process.exit(1);
                    }
                    db.query(
                        `CREATE TABLE IF NOT EXISTS tournament_venues (
                            tournament_id INT NOT NULL,
                            venue_id INT NOT NULL,
                            selected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                            PRIMARY KEY (tournament_id, venue_id),
                            FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE,
                            FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE CASCADE
                        )`,
                        (selectionTableErr) => {
                            if (selectionTableErr) {
                                console.error('Could not create tournament_venues:', selectionTableErr.message);
                                process.exit(1);
                            }
                            db.query("SHOW COLUMNS FROM tournament_venues LIKE 'availability_id'", (columnErr, columns) => {
                                if (columnErr) {
                                    console.error('Could not check tournament_venues.availability_id:', columnErr.message);
                                    process.exit(1);
                                }
                                const ensurePlayerMemberships = () => {
                                    db.query(
                                        `CREATE TABLE IF NOT EXISTS player_team_memberships (
                                            user_id INT NOT NULL,
                                            team_id INT NOT NULL,
                                            joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                                            PRIMARY KEY (user_id, team_id),
                                            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                                            FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
                                        )`,
                                        (membershipTableErr) => {
                                            if (membershipTableErr) {
                                                console.error('Could not create player_team_memberships:', membershipTableErr.message);
                                                process.exit(1);
                                            }
                                            db.query(
                                                `INSERT IGNORE INTO player_team_memberships (user_id, team_id)
                                                 SELECT tp.user_id, tp.team_id FROM team_players tp
                                                 JOIN users u ON u.id = tp.user_id WHERE u.role = 'PLAYER'`,
                                                (byIdErr) => {
                                                    if (byIdErr) {
                                                        console.error('Could not migrate player team memberships:', byIdErr.message);
                                                        process.exit(1);
                                                    }
                                                    db.query(
                                                        `INSERT IGNORE INTO player_team_memberships (user_id, team_id)
                                                         SELECT u.id, tp.team_id FROM team_players tp
                                                         JOIN users u ON LOWER(u.email) = LOWER(tp.email)
                                                         WHERE u.role = 'PLAYER' AND tp.email IS NOT NULL`,
                                                        (byEmailErr) => {
                                                            if (byEmailErr) {
                                                                console.error('Could not migrate player team memberships by email:', byEmailErr.message);
                                                                process.exit(1);
                                                            }
                                                            db.query(
                                                                `DELETE tp FROM team_players tp
                                                                 JOIN users u ON u.id = tp.user_id OR
                                                                                 (tp.email IS NOT NULL AND LOWER(u.email) = LOWER(tp.email))
                                                                 WHERE u.role = 'PLAYER'`,
                                                                (cleanupErr) => {
                                                                    if (cleanupErr) {
                                                                        console.error('Could not remove player accounts from Add Player roster:', cleanupErr.message);
                                                                        process.exit(1);
                                                                    }
                                                                    db.query("SHOW COLUMNS FROM teams LIKE 'group_name'", (groupColumnErr, groupColumns) => {
                                                                        if (groupColumnErr) {
                                                                            console.error('Could not check teams.group_name:', groupColumnErr.message);
                                                                            process.exit(1);
                                                                        }
                                                                        const startServer = () => {
                                                                            db.query("SHOW COLUMNS FROM fixtures LIKE 'is_bye'", (byeColumnErr, byeColumns) => {
                                                                                if (byeColumnErr) {
                                                                                    console.error('Could not check fixtures.is_bye:', byeColumnErr.message);
                                                                                    process.exit(1);
                                                                                }
                                                                                const listen = () => app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
                                                                                if (byeColumns.length) return listen();
                                                                                db.query('ALTER TABLE fixtures ADD COLUMN is_bye TINYINT(1) NOT NULL DEFAULT 0', (byeAlterErr) => {
                                                                                    if (byeAlterErr) {
                                                                                        console.error('Could not add fixtures.is_bye:', byeAlterErr.message);
                                                                                        process.exit(1);
                                                                                    }
                                                                                    console.log('Added fixtures.is_bye.');
                                                                                    listen();
                                                                                });
                                                                            });
                                                                        };
                                                                        if (groupColumns.length) return startServer();
                                                                        db.query('ALTER TABLE teams ADD COLUMN group_name VARCHAR(100) DEFAULT NULL', (groupAlterErr) => {
                                                                            if (groupAlterErr) {
                                                                                console.error('Could not add teams.group_name:', groupAlterErr.message);
                                                                                process.exit(1);
                                                                            }
                                                                            startServer();
                                                                        });
                                                                    });
                                                                }
                                                            );
                                                        }
                                                    );
                                                }
                                            );
                                        }
                                    );
                                };
                                if (columns.length) return ensurePlayerMemberships();
                                db.query('ALTER TABLE tournament_venues ADD COLUMN availability_id INT DEFAULT NULL', (alterErr) => {
                                    if (alterErr) {
                                        console.error('Could not add tournament_venues.availability_id:', alterErr.message);
                                        process.exit(1);
                                    }
                                    ensurePlayerMemberships();
                                });
                            });
                        }
                    );
                }
            );
            });
        });
    });
    });
});
