'use strict';

// One-time cleanup. Keeps one tournament and relies on the schema's cascade
// rules to remove its peers' teams, rosters, memberships, fixtures, and links.
// Run with KEEP_TOURNAMENT_ID=10 node cleanup_keep_tournament.js
const db = require('./config/db');

const keepId = Number(process.env.KEEP_TOURNAMENT_ID);
if (!Number.isInteger(keepId) || keepId < 1) {
    console.error('Set KEEP_TOURNAMENT_ID to the tournament id to keep.');
    process.exit(1);
}

(async () => {
    let connection;
    try {
        connection = await db.promise().getConnection();
        await connection.beginTransaction();

        const [kept] = await connection.query(
            'SELECT id, name FROM tournaments WHERE id = ? FOR UPDATE',
            [keepId]
        );
        if (!kept.length) throw new Error(`Tournament ${keepId} was not found.`);

        const [[counts]] = await connection.query(
            `SELECT COUNT(*) AS tournament_count,
                    (SELECT COUNT(*) FROM teams WHERE tournament_id <> ?) AS team_count
             FROM tournaments WHERE id <> ?`,
            [keepId, keepId]
        );

        const [deleted] = await connection.query(
            'DELETE FROM tournaments WHERE id <> ?',
            [keepId]
        );

        await connection.commit();
        console.log(JSON.stringify({
            keptTournamentId: keepId,
            keptTournamentName: kept[0].name,
            tournamentsRemoved: deleted.affectedRows,
            teamsRemovedByCascade: counts.team_count,
        }));
    } catch (error) {
        if (connection) {
            try { await connection.rollback(); } catch (_) { /* transaction already closed */ }
        }
        console.error('Cleanup failed:', error.message);
        process.exitCode = 1;
    } finally {
        if (connection) connection.release();
        db.end();
    }
})();
