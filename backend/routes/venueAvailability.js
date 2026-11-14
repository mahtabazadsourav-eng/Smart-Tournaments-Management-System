const express = require('express');
const db = require('../config/db');
const { verifyToken, authorizeRole } = require('../middleware/auth');

const router = express.Router();

// Add Venue Availability
router.post(
    '/',
    verifyToken,
    authorizeRole('ADMIN', 'VENUE_COORDINATOR'),
    (req, res) => {
        const {
            venue_id,
            available_date,
            start_time,
            end_time
        } = req.body;

        if (!venue_id || !available_date || !start_time || !end_time) {
            return res.status(400).json({
                message: 'All fields are required'
            });
        }

        if (start_time >= end_time) {
            return res.status(400).json({
                message: 'End time must be later than start time'
            });
        }

        const sql = `
            INSERT INTO venue_availability
            (venue_id, available_date, start_time, end_time)
            SELECT id, ?, ?, ?
            FROM venues
            WHERE id = ?
            AND (coordinator_id = ? OR ? = 'ADMIN')
        `;

        db.query(sql, [
            available_date,
            start_time,
            end_time,
            venue_id,
            req.user.id,
            req.user.role
        ], (err, result) => {
            if (err) {
                console.error('Add availability error:', err);
                return res.status(500).json({
                    message: 'Failed to add availability'
                });
            }

            if (result.affectedRows === 0) {
                return res.status(404).json({
                    message: 'Venue not found or access denied'
                });
            }

            res.status(201).json({
                message: 'Venue availability added successfully',
                availabilityId: result.insertId
            });
        });
    }
);

// View Venue Availability
router.get(
    '/',
    verifyToken,
    authorizeRole('ADMIN', 'VENUE_COORDINATOR', 'ORGANIZER'),
    (req, res) => {
        const { venue_id } = req.query;

        let sql = `
            SELECT venue_availability.*, venues.venue_name
            FROM venue_availability
            JOIN venues ON venue_availability.venue_id = venues.id
            WHERE 1 = 1
        `;

        const params = [];

        if (req.user.role !== 'ADMIN' &&
            req.user.role !== 'ORGANIZER') {
            sql += ' AND venues.coordinator_id = ?';
            params.push(req.user.id);
        }

        if (venue_id) {
            sql += ' AND venue_availability.venue_id = ?';
            params.push(venue_id);
        }

        sql += ' ORDER BY available_date, start_time';

        db.query(sql, params, (err, results) => {
            if (err) {
                console.error('View availability error:', err);
                return res.status(500).json({
                    message: 'Failed to retrieve availability'
                });
            }

            res.status(200).json({
                message: 'Availability retrieved successfully',
                availability: results
            });
        });
    }
);

// Update Venue Availability
router.put(
    '/:id',
    verifyToken,
    authorizeRole('ADMIN', 'VENUE_COORDINATOR'),
    (req, res) => {
        const {
            available_date,
            start_time,
            end_time,
            is_available
        } = req.body;

        if (!available_date || !start_time || !end_time ||
            is_available === undefined) {
            return res.status(400).json({
                message: 'All fields are required'
            });
        }

        if (start_time >= end_time) {
            return res.status(400).json({
                message: 'End time must be later than start time'
            });
        }

        const sql = `
            UPDATE venue_availability
            JOIN venues ON venue_availability.venue_id = venues.id
            SET
                available_date = ?,
                start_time = ?,
                end_time = ?,
                is_available = ?
            WHERE venue_availability.id = ?
            AND (venues.coordinator_id = ? OR ? = 'ADMIN')
        `;

        db.query(sql, [
            available_date,
            start_time,
            end_time,
            is_available,
            req.params.id,
            req.user.id,
            req.user.role
        ], (err, result) => {
            if (err) {
                console.error('Update availability error:', err);
                return res.status(500).json({
                    message: 'Failed to update availability'
                });
            }

            if (result.affectedRows === 0) {
                return res.status(404).json({
                    message: 'Availability not found or no changes made'
                });
            }

            res.status(200).json({
                message: 'Availability updated successfully'
            });
        });
    }
);

// Delete Venue Availability
router.delete(
    '/:id',
    verifyToken,
    authorizeRole('ADMIN', 'VENUE_COORDINATOR'),
    (req, res) => {
        const sql = `
            DELETE venue_availability
            FROM venue_availability
            JOIN venues ON venue_availability.venue_id = venues.id
            WHERE venue_availability.id = ?
            AND (venues.coordinator_id = ? OR ? = 'ADMIN')
        `;

        db.query(sql, [
            req.params.id,
            req.user.id,
            req.user.role
        ], (err, result) => {
            if (err) {
                console.error('Delete availability error:', err);
                return res.status(500).json({
                    message: 'Failed to delete availability'
                });
            }

            if (result.affectedRows === 0) {
                return res.status(404).json({
                    message: 'Availability not found or access denied'
                });
            }

            res.status(200).json({
                message: 'Availability deleted successfully'
            });
        });
    }
);

module.exports = router;