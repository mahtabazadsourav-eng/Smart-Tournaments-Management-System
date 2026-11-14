
const express = require('express');
const db = require('../config/db');
const { verifyToken, authorizeRole } = require('../middleware/auth');

const router = express.Router();

// Add Venue API
router.post(
    '/',
    verifyToken,
    authorizeRole('ADMIN', 'VENUE_COORDINATOR'),
    (req, res) => {
        const {
            venue_name,
            location,
            venue_type,
            capacity
        } = req.body;

        if (!venue_name || !location || !venue_type || !capacity) {
            return res.status(400).json({
                message: 'All venue fields are required'
            });
        }

        const allowedTypes = ['CRICKET', 'FOOTBALL', 'FUTSAL'];

        if (!allowedTypes.includes(venue_type) ||
            !Number.isInteger(Number(capacity)) ||
            Number(capacity) <= 0) {
            return res.status(400).json({
                message: 'Invalid venue type or capacity'
            });
        }

        const sql = `
            INSERT INTO venues
            (venue_name, location, venue_type, capacity, coordinator_id)
            VALUES (?, ?, ?, ?, ?)
        `;

        db.query(sql, [
            venue_name,
            location,
            venue_type,
            Number(capacity),
            req.user.id
        ], (err, result) => {
            if (err) {
                console.error('Add venue error:', err);
                return res.status(500).json({
                    message: 'Failed to add venue'
                });
            }

            res.status(201).json({
                message: 'Venue added successfully',
                venueId: result.insertId
            });
        });
    }
);

// View Venues API
router.get(
    '/',
    verifyToken,
    authorizeRole('ADMIN', 'VENUE_COORDINATOR', 'ORGANIZER'),
    (req, res) => {
        const isAdmin = req.user.role === 'ADMIN';

        const sql = isAdmin
            ? `SELECT * FROM venues`
            : `SELECT * FROM venues WHERE coordinator_id = ?`;

        const values = isAdmin ? [] : [req.user.id];

        db.query(sql, values, (err, results) => {
            if (err) {
                console.error('View venues error:', err);
                return res.status(500).json({
                    message: 'Failed to fetch venues'
                });
            }

            res.status(200).json({
                message: 'Venues retrieved successfully',
                venues: results
            });
        });
    }
);

// Update Venue API
router.put(
    '/:id',
    verifyToken,
    authorizeRole('ADMIN', 'VENUE_COORDINATOR'),
    (req, res) => {
        const {
            venue_name,
            location,
            venue_type,
            capacity
        } = req.body;

        if (!venue_name || !location || !venue_type || !capacity) {
            return res.status(400).json({
                message: 'All venue fields are required'
            });
        }

        const allowedTypes = ['CRICKET', 'FOOTBALL', 'FUTSAL'];

        if (!allowedTypes.includes(venue_type) ||
            !Number.isInteger(Number(capacity)) ||
            Number(capacity) <= 0) {
            return res.status(400).json({
                message: 'Invalid venue type or capacity'
            });
        }

        const isAdmin = req.user.role === 'ADMIN';

        const sql = isAdmin
            ? `UPDATE venues
               SET venue_name=?, location=?, venue_type=?, capacity=?
               WHERE id=?`
            : `UPDATE venues
               SET venue_name=?, location=?, venue_type=?, capacity=?
               WHERE id=? AND coordinator_id=?`;

        const values = isAdmin
            ? [venue_name, location, venue_type, Number(capacity), req.params.id]
            : [venue_name, location, venue_type, Number(capacity), req.params.id, req.user.id];

        db.query(sql, values, (err, result) => {
            if (err) {
                console.error('Update venue error:', err);
                return res.status(500).json({
                    message: 'Failed to update venue'
                });
            }

            if (result.affectedRows === 0) {
                return res.status(404).json({
                    message: 'Venue not found or access denied'
                });
            }

            res.status(200).json({
                message: 'Venue updated successfully'
            });
        });
    }
);

// Delete Venue API
router.delete(
    '/:id',
    verifyToken,
    authorizeRole('ADMIN', 'VENUE_COORDINATOR'),
    (req, res) => {
        const isAdmin = req.user.role === 'ADMIN';

        const sql = isAdmin
            ? `DELETE FROM venues WHERE id=?`
            : `DELETE FROM venues WHERE id=? AND coordinator_id=?`;

        const values = isAdmin
            ? [req.params.id]
            : [req.params.id, req.user.id];

        db.query(sql, values, (err, result) => {
            if (err) {
                console.error('Delete venue error:', err);
                return res.status(500).json({
                    message: 'Failed to delete venue'
                });
            }

            if (result.affectedRows === 0) {
                return res.status(404).json({
                    message: 'Venue not found or access denied'
                });
            }

            res.status(200).json({
                message: 'Venue deleted successfully'
            });
        });
    }
);

module.exports = router;
