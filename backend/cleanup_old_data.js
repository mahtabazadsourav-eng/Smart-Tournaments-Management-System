'use strict';

// One-time cleanup for records created before a local calendar date.
// Run with CLEANUP_BEFORE_DATE=YYYY-MM-DD node cleanup_old_data.js
// Related fixtures, roster rows, memberships, availability, and tournament
// venue selections are removed by the database's ON DELETE CASCADE rules.
const db = require('./config/db');

const cutoff = process.env.CLEANUP_BEFORE_DATE;
if (!/^\d{4}-\d{2}-\d{2}$/.test(cutoff || '')) {
    console.error('Set CLEANUP_BEFORE_DATE to a date such as 2026-11-16.');
    process.exit(1);
}

(async () => {
    let connection;
    try {
        connection = await db.promise().getConnection();
        await connection.beginTransaction();

        const [[teamCount]] = await connection.query(
            `SELECT COUNT(*) AS count FROM teams
             WHERE created_at < ? OR tournament_id IN (
                 SELECT id FROM tournaments WHERE created_at < ?
             )`,
            [cutoff, cutoff]
        );
        const [[tournamentCount]] = await connection.query(
            'SELECT COUNT(*) AS count FROM tournaments WHERE created_at < ?',
            [cutoff]
        );

        const [teamResult] = await connection.query(
            `DELETE FROM teams
             WHERE created_at < ? OR tournament_id IN (
                 SELECT id FROM tournaments WHERE created_at < ?
             )`,
            [cutoff, cutoff]
        );
        const [tournamentResult] = await connection.query(
            'DELETE FROM tournaments WHERE created_at < ?',
            [cutoff]
        );

        await connection.commit();
        console.log(JSON.stringify({
            cutoff,
            teamsRemoved: teamResult.affectedRows,
            tournamentsRemoved: tournamentResult.affectedRows,
            teamsMatchedBeforeDelete: teamCount.count,
            tournamentsMatchedBeforeDelete: tournamentCount.count,
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
