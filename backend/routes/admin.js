/** Admin-only system monitoring endpoint. */
'use strict';
const express = require('express');
const os = require('os');
const db = require('../config/db');
const { verifyToken, authorizeRole } = require('../middleware/auth');
const router = express.Router();

router.get('/monitoring', verifyToken, authorizeRole('ADMIN'), async (req, res) => {
    const started = Date.now();
    try {
        const [[database]] = await db.promise().query('SELECT 1 AS connected');
        const countQueries = [
            ['users', 'SELECT COUNT(*) AS total FROM users'],
            ['tournaments', 'SELECT COUNT(*) AS total FROM tournaments'],
            ['teams', 'SELECT COUNT(*) AS total FROM teams'],
            ['venues', 'SELECT COUNT(*) AS total FROM venues'],
            ['fixtures', 'SELECT COUNT(*) AS total FROM fixtures'],
            ['completed_fixtures', "SELECT COUNT(*) AS total FROM fixtures WHERE status = 'COMPLETED'"],
            ['match_results', 'SELECT COUNT(*) AS total FROM match_results']
        ];
        const counts = {};
        for (const [key, sql] of countQueries) {
            const [rows] = await db.promise().query(sql);
            counts[key] = Number(rows[0].total);
        }
        return res.json({
            status: 'OPERATIONAL',
            database: database.connected === 1 ? 'CONNECTED' : 'UNKNOWN',
            response_time_ms: Date.now() - started,
            uptime_seconds: Math.floor(process.uptime()),
            server: { platform: process.platform, node_version: process.version, hostname: os.hostname() },
            memory: { rss_bytes: process.memoryUsage().rss, heap_used_bytes: process.memoryUsage().heapUsed, heap_total_bytes: process.memoryUsage().heapTotal },
            counts,
            checked_at: new Date().toISOString()
        });
    } catch (error) {
        console.error('System monitoring error:', error.message);
        return res.status(503).json({ status: 'DEGRADED', database: 'UNAVAILABLE', message: 'Monitoring could not read database metrics' });
    }
});

module.exports = router;
