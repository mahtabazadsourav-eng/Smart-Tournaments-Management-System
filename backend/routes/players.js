const express = require('express');
const db = require('../config/db');
const { verifyToken, authorizeRole } = require('../middleware/auth');

const router = express.Router();

// Add Player to Team
// Add Player to Team
router.post(
    '/',
    verifyToken,
    authorizeRole('ORGANIZER', 'ADMIN', 'TEAM_CAPTAIN_PLAYER'),
    async (req, res) => {
        const {
            team_id,
            player_name,
            email = null,
            team_role = 'PLAYER',
            jersey_number,
            player_position
        } = req.body;

        if (!team_id || !player_name) {
            return res.status(400).json({ message: 'Team ID and player name are required' });
        }
        const normalizedEmail = email ? String(email).trim().toLowerCase() : null;
        if (normalizedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
            return res.status(400).json({ message: 'Enter a valid player email address' });
        }
        if (!['PLAYER', 'CAPTAIN', 'VICE_CAPTAIN'].includes(team_role)) {
            return res.status(400).json({ message: 'Invalid team player role' });
        }

        let connection;
        try {
            connection = await db.promise().getConnection();
            await connection.beginTransaction();
            const [teamRows] = await connection.query(
                `SELECT teams.id, teams.captain_id, tournaments.organizer_id
                 FROM teams JOIN tournaments ON tournaments.id = teams.tournament_id
                 WHERE teams.id = ? FOR UPDATE`,
                [team_id]
            );
            if (!teamRows.length) {
                await connection.rollback();
                return res.status(404).json({ message: 'Team not found' });
            }
            const team = teamRows[0];
            const allowed = req.user.role === 'ADMIN' ||
                (req.user.role === 'ORGANIZER' && Number(team.organizer_id) === Number(req.user.id)) ||
                (req.user.role === 'TEAM_CAPTAIN_PLAYER' && Number(team.captain_id) === Number(req.user.id));
            if (!allowed) {
                await connection.rollback();
                return res.status(403).json({ message: 'Access denied' });
            }

            const [emailRows] = normalizedEmail ? await connection.query(
                'SELECT id FROM team_players WHERE team_id = ? AND LOWER(email) = ? LIMIT 1 FOR UPDATE',
                [team_id, normalizedEmail]
            ) : [[]];
            if (emailRows.length) {
                await connection.rollback();
                return res.status(409).json({ message: 'This email is already on the team roster' });
            }
            if (team_role !== 'PLAYER') {
                const [roleRows] = await connection.query(
                    'SELECT id FROM team_players WHERE team_id = ? AND team_role = ? LIMIT 1 FOR UPDATE',
                    [team_id, team_role]
                );
                if (roleRows.length || (team_role === 'CAPTAIN' && team.captain_id)) {
                    await connection.rollback();
                    return res.status(409).json({ message: `This team already has a ${team_role.toLowerCase().replace('_', ' ')}` });
                }
            }

            const [accountRows] = normalizedEmail ? await connection.query(
                'SELECT id, name, role FROM users WHERE LOWER(email) = ? LIMIT 1',
                [normalizedEmail]
            ) : [[]];
            const account = accountRows[0] || null;
            if (team_role === 'CAPTAIN' && account && account.role !== 'TEAM_CAPTAIN_PLAYER') {
                await connection.rollback();
                return res.status(400).json({ message: 'The captain email must belong to a player account' });
            }

            const [insertResult] = await connection.query(
                `INSERT INTO team_players
                 (team_id, user_id, player_name, email, team_role, jersey_number, player_position)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [team_id, account?.id || null, account?.name || player_name.trim(), normalizedEmail, team_role,
                    jersey_number || null, player_position || null]
            );
            if (team_role === 'CAPTAIN' && account) {
                await connection.query('UPDATE teams SET captain_id = ? WHERE id = ?', [account.id, team_id]);
            }
            await connection.commit();
            return res.status(201).json({
                message: 'Player added successfully',
                playerId: insertResult.insertId,
                captainAssigned: team_role === 'CAPTAIN' && Boolean(account),
                captainPendingSignup: team_role === 'CAPTAIN' && !account
            });
        } catch (err) {
            if (connection) {
                try { await connection.rollback(); } catch (_) { /* transaction already closed */ }
            }
            console.error('Add player error:', err.message);
            return res.status(500).json({ message: 'Failed to add player' });
        } finally {
            if (connection) connection.release();
        }
    }
);

// View Team Players
router.get(
    '/',
    verifyToken,
    authorizeRole('ORGANIZER', 'ADMIN', 'TEAM_CAPTAIN_PLAYER', 'PLAYER'),
    (req, res) => {
        const { team_id } = req.query;

        if (!team_id) {
            return res.status(400).json({
                message: 'Team ID is required'
            });
        }

        
            const sql = `
    SELECT
        team_players.*,
        COALESCE(NULLIF(team_players.player_name, ''), users.name) AS name
    FROM team_players
    JOIN teams ON team_players.team_id = teams.id
    JOIN tournaments ON teams.tournament_id = tournaments.id
    LEFT JOIN users ON team_players.user_id = users.id
            WHERE teams.id = ?
            AND (
                ? IN ('ADMIN', 'PLAYER')
                OR tournaments.organizer_id = ?
                OR teams.captain_id = ?
                OR EXISTS (SELECT 1 FROM player_team_memberships membership WHERE membership.team_id = teams.id AND membership.user_id = ?)
                OR EXISTS (SELECT 1 FROM team_players captain_membership WHERE captain_membership.team_id = teams.id AND captain_membership.user_id = ?)
            )
        `;

        db.query(sql, [
            team_id,
            req.user.role,
            req.user.id,
            req.user.id,
            req.user.id,
            req.user.id
        ], (err, results) => {
            if (err) {
                console.error('View players error:', err);
                return res.status(500).json({
                    message: 'Failed to fetch players'
                });
            }

            res.status(200).json({
                message: 'Players retrieved successfully',
                players: results
            });
        });
    }
);

// Update Player Information
router.put(
    '/:id',
    verifyToken,
    authorizeRole('ORGANIZER', 'ADMIN', 'TEAM_CAPTAIN_PLAYER'),
    (req, res) => {
        const { jersey_number, player_position } = req.body;

        const sql = `
            UPDATE team_players
            JOIN teams ON team_players.team_id = teams.id
            JOIN tournaments ON teams.tournament_id = tournaments.id
            SET team_players.jersey_number = ?,
                team_players.player_position = ?
            WHERE team_players.id = ?
            AND (
                ? = 'ADMIN'
                OR tournaments.organizer_id = ?
                OR teams.captain_id = ?
            )
        `;

        db.query(sql, [
            jersey_number || null,
            player_position || null,
            req.params.id,
            req.user.role,
            req.user.id,
            req.user.id
        ], (err, result) => {
            if (err) {
                console.error('Update player error:', err);
                return res.status(500).json({
                    message: 'Failed to update player'
                });
            }

            if (result.affectedRows === 0) {
                return res.status(404).json({
                    message: 'Player not found or access denied'
                });
            }

            res.status(200).json({
                message: 'Player updated successfully'
            });
        });
    }
);

// Remove Player from Team
router.delete(
    '/:id',
    verifyToken,
    authorizeRole('ORGANIZER', 'ADMIN', 'TEAM_CAPTAIN_PLAYER'),
    async (req, res) => {
        let connection;
        try {
            connection = await db.promise().getConnection();
            await connection.beginTransaction();
            const [rows] = await connection.query(
                `SELECT tp.id, tp.team_id, tp.user_id, tp.team_role, teams.captain_id, tournaments.organizer_id
                 FROM team_players tp
                 JOIN teams ON teams.id = tp.team_id
                 JOIN tournaments ON tournaments.id = teams.tournament_id
                 WHERE tp.id = ? FOR UPDATE`,
                [req.params.id]
            );
            if (!rows.length) {
                await connection.rollback();
                return res.status(404).json({ message: 'Player not found' });
            }
            const player = rows[0];
            const allowed = req.user.role === 'ADMIN' ||
                (req.user.role === 'ORGANIZER' && Number(player.organizer_id) === Number(req.user.id)) ||
                (req.user.role === 'TEAM_CAPTAIN_PLAYER' && Number(player.captain_id) === Number(req.user.id));
            if (!allowed) {
                await connection.rollback();
                return res.status(403).json({ message: 'Access denied' });
            }
            if (player.team_role === 'CAPTAIN' && player.user_id === player.captain_id) {
                await connection.query('UPDATE teams SET captain_id = NULL WHERE id = ?', [player.team_id]);
            }
            await connection.query('DELETE FROM team_players WHERE id = ?', [player.id]);
            await connection.commit();
            return res.status(200).json({ message: 'Player removed successfully' });
        } catch (err) {
            if (connection) {
                try { await connection.rollback(); } catch (_) { /* transaction already closed */ }
            }
            console.error('Delete player error:', err.message);
            return res.status(500).json({ message: 'Failed to remove player' });
        } finally {
            if (connection) connection.release();
        }
    }
);

module.exports = router;
