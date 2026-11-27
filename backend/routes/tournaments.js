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

        if (!['CRICKET', 'FOOTBALL', 'FUTSAL'].includes(sport) ||
            !['KNOCKOUT', 'LEAGUE', 'GROUP_STAGE'].includes(format) ||
            end_date < start_date) {
            return res.status(400).json({ message: 'Invalid sport, format, or tournament date range' });
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
    authorizeRole('ORGANIZER', 'ADMIN', 'PLAYER'),
    (req, res) => {

        const isAdmin = req.user.role === 'ADMIN';
        const isPlayer = req.user.role === 'PLAYER';

        const sql = isAdmin
            ? `SELECT * FROM tournaments`
            : isPlayer
                ? `SELECT id, name, sport, format, start_date, end_date,
                          match_start_time, match_end_time, match_duration_minutes, minimum_rest_minutes
                   FROM tournaments`
                : `SELECT * FROM tournaments WHERE organizer_id = ?`;

        const values = isAdmin || isPlayer ? [] : [req.user.id];

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

// Delete a tournament and its dependent data (foreign keys cascade).
router.delete(
    '/:id',
    verifyToken,
    authorizeRole('ORGANIZER', 'ADMIN'),
    (req, res) => {
        const isAdmin = req.user.role === 'ADMIN';
        const sql = isAdmin
            ? 'DELETE FROM tournaments WHERE id = ?'
            : 'DELETE FROM tournaments WHERE id = ? AND organizer_id = ?';
        const values = isAdmin ? [req.params.id] : [req.params.id, req.user.id];
        db.query(sql, values, (err, result) => {
            if (err) {
                console.error('Delete tournament error:', err);
                return res.status(500).json({ message: 'Failed to delete tournament' });
            }
            if (!result.affectedRows) {
                return res.status(404).json({ message: 'Tournament not found or access denied' });
            }
            return res.status(200).json({ message: 'Tournament deleted successfully' });
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
            !allowedFormats.includes(format) || end_date < start_date) {
            return res.status(400).json({
                message: 'Invalid sport, format, or tournament date range'
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
            minimum_rest_minutes,
            start_date,
            end_date
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

        const isValidDate = (value) => {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
            const parsed = new Date(`${value}T00:00:00.000Z`);
            return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
        };
        if ((start_date && !end_date) || (!start_date && end_date) ||
            (start_date && (!isValidDate(start_date) || !isValidDate(end_date) || end_date < start_date))) {
            return res.status(400).json({ message: 'Enter a valid tournament start and end date range' });
        }

        const toMinutes = (value) => {
            const [hours, minutes] = String(value).split(':').map(Number);
            return hours * 60 + minutes;
        };
        if (!/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(match_start_time) ||
            !/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(match_end_time) ||
            Number(match_duration_minutes) > toMinutes(match_end_time) - toMinutes(match_start_time)) {
            return res.status(400).json({ message: 'Match times must be valid and the duration must fit within the daily schedule window' });
        }

        const isAdmin = req.user.role === 'ADMIN';

        const sql = isAdmin
            ? `UPDATE tournaments
               SET start_date = COALESCE(?, start_date),
                   end_date = COALESCE(?, end_date),
                   match_start_time = ?,
                   match_end_time = ?,
                   match_duration_minutes = ?,
                   minimum_rest_minutes = ?
               WHERE id = ?`
            : `UPDATE tournaments
               SET start_date = COALESCE(?, start_date),
                   end_date = COALESCE(?, end_date),
                   match_start_time = ?,
                   match_end_time = ?,
                   match_duration_minutes = ?,
                   minimum_rest_minutes = ?
               WHERE id = ? AND organizer_id = ?`;

        const values = isAdmin
            ? [
                start_date || null,
                end_date || null,
                match_start_time,
                match_end_time,
                match_duration_minutes,
                minimum_rest_minutes,
                req.params.id
            ]
            : [
                start_date || null,
                end_date || null,
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
                const existsSql = isAdmin
                    ? 'SELECT id FROM tournaments WHERE id = ?'
                    : 'SELECT id FROM tournaments WHERE id = ? AND organizer_id = ?';
                const existsValues = isAdmin ? [req.params.id] : [req.params.id, req.user.id];
                db.query(existsSql, existsValues, (checkErr, rows) => {
                    if (checkErr) return res.status(500).json({ message: 'Failed to verify tournament schedule' });
                    if (!rows.length) return res.status(404).json({ message: 'Tournament not found or access denied' });
                    return res.status(200).json({ message: 'Tournament scheduling configuration saved successfully' });
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
