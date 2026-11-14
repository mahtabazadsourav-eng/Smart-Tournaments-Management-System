const express = require('express');
const db = require('../config/db');
const { verifyToken, authorizeRole } = require('../middleware/auth');

const router = express.Router();

// Create Tournament API
router.post(
    '/',
    verifyToken,
    authorizeRole('ORGANIZER', 'ADMIN'),
    (req, res) => {

        const {
            name,
            sport,
            format,
            start_date,
            end_date
        } = req.body;

        if (!name || !sport || !format || !start_date || !end_date) {
            return res.status(400).json({
                message: 'All tournament fields are required'
            });
        }

        const sql = `
            INSERT INTO tournaments
            (organizer_id, name, sport, format, start_date, end_date)
            VALUES (?, ?, ?, ?, ?, ?)
        `;

        db.query(
            sql,
            [
                req.user.id,
                name,
                sport,
                format,
                start_date,
                end_date
            ],
            (err, result) => {

                if (err) {
                    console.error('Tournament error:', err);

                    return res.status(500).json({
                        message: 'Failed to create tournament'
                    });
                }

                res.status(201).json({
                    message: 'Tournament created successfully',
                    tournamentId: result.insertId
                });
            }
        );
    }
);

// View Organizer's Tournaments API

// View Tournaments API
router.get(
    '/',
    verifyToken,
    authorizeRole('ORGANIZER', 'ADMIN'),
    (req, res) => {

        const isAdmin = req.user.role === 'ADMIN';

        const sql = isAdmin
            ? `SELECT * FROM tournaments`
            : `SELECT * FROM tournaments WHERE organizer_id = ?`;

        const values = isAdmin ? [] : [req.user.id];

        db.query(sql, values, (err, results) => {

            if (err) {
                console.error('View tournament error:', err);

                return res.status(500).json({
                    message: 'Failed to fetch tournaments'
                });
            }

            res.status(200).json({
                message: 'Tournaments retrieved successfully',
                tournaments: results
            });
        });
    }
);

// Update Tournament API
router.put(
    '/:id',
    verifyToken,
    authorizeRole('ORGANIZER', 'ADMIN'),
    (req, res) => {

        const {
            name,
            sport,
            format,
            start_date,
            end_date
        } = req.body;

        if (!name || !sport || !format || !start_date || !end_date) {
            return res.status(400).json({
                message: 'All tournament fields are required'
            });
        }

        const allowedSports = ['CRICKET', 'FOOTBALL', 'FUTSAL'];
        const allowedFormats = ['KNOCKOUT', 'LEAGUE', 'GROUP_STAGE'];

        if (!allowedSports.includes(sport) ||
            !allowedFormats.includes(format)) {
            return res.status(400).json({
                message: 'Invalid sport or tournament format'
            });
        }

        const isAdmin = req.user.role === 'ADMIN';

        const sql = isAdmin
            ? `UPDATE tournaments
               SET name=?, sport=?, format=?, start_date=?, end_date=?
               WHERE id=?`
            : `UPDATE tournaments
               SET name=?, sport=?, format=?, start_date=?, end_date=?
               WHERE id=? AND organizer_id=?`;

        const values = isAdmin
            ? [name, sport, format, start_date, end_date, req.params.id]
            : [name, sport, format, start_date, end_date, req.params.id, req.user.id];

        db.query(sql, values, (err, result) => {

            if (err) {
                console.error('Update tournament error:', err);

                return res.status(500).json({
                    message: 'Failed to update tournament'
                });
            }

            if (result.affectedRows === 0) {
                return res.status(404).json({
                    message: 'Tournament not found or access denied'
                });
            }

            res.status(200).json({
                message: 'Tournament updated successfully'
            });
        });
    }
);
// Update Tournament Scheduling API
router.put(
    '/:id/schedule',
    verifyToken,
    authorizeRole('ORGANIZER', 'ADMIN'),
    (req, res) => {

        const {
            match_start_time,
            match_end_time,
            match_duration_minutes,
            minimum_rest_minutes
        } = req.body;

        if (
            !match_start_time ||
            !match_end_time ||
            match_duration_minutes === undefined ||
            minimum_rest_minutes === undefined
        ) {
            return res.status(400).json({
                message: 'All scheduling fields are required'
            });
        }

        if (
            match_start_time >= match_end_time ||
            Number(match_duration_minutes) <= 0 ||
            Number(minimum_rest_minutes) < 0 ||
            !Number.isInteger(Number(match_duration_minutes)) ||
            !Number.isInteger(Number(minimum_rest_minutes))
        ) {
            return res.status(400).json({
                message: 'Invalid scheduling information'
            });
        }

        const isAdmin = req.user.role === 'ADMIN';

        const sql = isAdmin
            ? `UPDATE tournaments
               SET match_start_time = ?,
                   match_end_time = ?,
                   match_duration_minutes = ?,
                   minimum_rest_minutes = ?
               WHERE id = ?`
            : `UPDATE tournaments
               SET match_start_time = ?,
                   match_end_time = ?,
                   match_duration_minutes = ?,
                   minimum_rest_minutes = ?
               WHERE id = ? AND organizer_id = ?`;

        const values = isAdmin
            ? [
                match_start_time,
                match_end_time,
                match_duration_minutes,
                minimum_rest_minutes,
                req.params.id
            ]
            : [
                match_start_time,
                match_end_time,
                match_duration_minutes,
                minimum_rest_minutes,
                req.params.id,
                req.user.id
            ];

        db.query(sql, values, (err, result) => {

            if (err) {
                console.error('Scheduling error:', err);

                return res.status(500).json({
                    message: 'Failed to update tournament scheduling'
                });
            }

            if (result.affectedRows === 0) {
                return res.status(404).json({
                    message: 'Tournament not found or access denied'
                });
            }

            res.status(200).json({
                message: 'Tournament scheduling updated successfully'
            });
        });
    }
);
// View Tournament Schedule API
router.get(
    '/:id/schedule',
    verifyToken,
    authorizeRole('ORGANIZER', 'ADMIN'),
    (req, res) => {
        const isAdmin = req.user.role === 'ADMIN';

        const sql = isAdmin
            ? `SELECT id, name, match_start_time, match_end_time,
                      match_duration_minutes, minimum_rest_minutes
               FROM tournaments
               WHERE id = ?`
            : `SELECT id, name, match_start_time, match_end_time,
                      match_duration_minutes, minimum_rest_minutes
               FROM tournaments
               WHERE id = ? AND organizer_id = ?`;

        const values = isAdmin
            ? [req.params.id]
            : [req.params.id, req.user.id];

        db.query(sql, values, (err, results) => {
            if (err) {
                return res.status(500).json({
                    message: 'Failed to retrieve tournament schedule'
                });
            }

            if (results.length === 0) {
                return res.status(404).json({
                    message: 'Tournament not found or access denied'
                });
            }

            res.status(200).json({
                message: 'Tournament schedule retrieved successfully',
                schedule: results[0]
            });
        });
    }
);
module.exports = router;