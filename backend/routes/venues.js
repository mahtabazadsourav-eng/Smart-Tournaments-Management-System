
const express = require('express');
const db = require('../config/db');
const { verifyToken, authorizeRole } = require('../middleware/auth');

const router = express.Router();

function timeToMinutes(value) {
    const match = String(value || '').match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
    if (!match) return NaN;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours > 23 || minutes > 59) return NaN;
    return hours * 60 + minutes;
}

function normalizedSport(value) {
    return String(value || '').trim().toUpperCase();
}

function dateKey(value) {
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    return String(value || '').slice(0, 10);
}

function hasSchedulableSlot(rows, tournament) {
    const windowStart = timeToMinutes(tournament.match_start_time);
    const windowEnd = timeToMinutes(tournament.match_end_time);
    const duration = Number(tournament.match_duration_minutes);
    if (!Number.isFinite(windowStart) || !Number.isFinite(windowEnd) ||
        !Number.isFinite(duration) || duration <= 0 || windowEnd <= windowStart ||
        duration > windowEnd - windowStart) {
        return false;
    }
    return rows.some(row => {
        const availableStart = timeToMinutes(row.start_time);
        const availableEnd = timeToMinutes(row.end_time);
        return Number.isFinite(availableStart) && Number.isFinite(availableEnd) &&
            availableStart <= windowStart && availableEnd >= windowEnd;
    });
}

// Venue choices and matching availability for an organizer's tournament.
router.get(
    '/for-tournament',
    verifyToken,
    authorizeRole('ORGANIZER', 'ADMIN'),
    async (req, res) => {
        const { tournament_id } = req.query;
        if (!tournament_id) return res.status(400).json({ message: 'Tournament ID is required' });
        try {
            const [tournaments] = await db.promise().query(
                `SELECT id, sport, start_date, end_date, match_start_time, match_end_time, match_duration_minutes
                 FROM tournaments WHERE id = ? AND (? = 'ADMIN' OR organizer_id = ?)`,
                [tournament_id, req.user.role, req.user.id]
            );
            if (!tournaments.length) return res.status(404).json({ message: 'Tournament not found or access denied' });
            const tournament = tournaments[0];
            if (!tournament.match_start_time || !tournament.match_end_time || tournament.match_duration_minutes == null) {
                return res.status(400).json({ message: 'Save the tournament scheduling configuration before selecting a venue' });
            }
            const [availabilityRows] = await db.promise().query(
                `SELECT v.id, va.id AS availability_id, v.venue_name, v.location, v.venue_type, v.capacity,
                        va.available_date, va.start_time, va.end_time, va.is_available,
                        (tv.venue_id IS NOT NULL) AS selected,
                        tv.availability_id AS selected_availability_id
                 FROM venues v
                 JOIN venue_availability va ON va.venue_id = v.id
                 LEFT JOIN tournament_venues tv ON tv.tournament_id = ? AND tv.venue_id = v.id
                 ORDER BY v.venue_name, va.available_date, va.start_time`,
                [tournament_id]
            );
            const tournamentStart = dateKey(tournament.start_date);
            const tournamentEnd = dateKey(tournament.end_date);
            const diagnostics = {
                venues: new Set(availabilityRows.map(row => Number(row.id))).size,
                matchingSportSlots: 0,
                matchingDateSlots: 0,
                availableSlots: 0,
                schedulableSlots: 0,
            };
            const rows = availabilityRows.filter(row => {
                const availableDate = dateKey(row.available_date);
                const available = row.is_available == null || Number(row.is_available) === 1;
                const matchingSport = normalizedSport(row.venue_type) === normalizedSport(tournament.sport);
                const matchingDate = availableDate >= tournamentStart && availableDate <= tournamentEnd;
                if (matchingSport) diagnostics.matchingSportSlots += 1;
                if (matchingSport && matchingDate) diagnostics.matchingDateSlots += 1;
                if (matchingSport && matchingDate && available) diagnostics.availableSlots += 1;
                const schedulable = matchingSport && matchingDate && available && hasSchedulableSlot([row], tournament);
                if (schedulable) diagnostics.schedulableSlots += 1;
                return schedulable;
            });
            return res.status(200).json({ tournament, venues: rows, diagnostics });
        } catch (err) {
            console.error('Tournament venue choices error:', err.message);
            return res.status(500).json({ message: 'Failed to load available tournament venues' });
        }
    }
);

// Persist the venues an organizer selected for a tournament.
router.post(
    '/selection',
    verifyToken,
    authorizeRole('ORGANIZER', 'ADMIN'),
    async (req, res) => {
        const { tournament_id, venue_ids, availability_id } = req.body;
        if (!tournament_id || !Array.isArray(venue_ids) || venue_ids.length !== 1) {
            return res.status(400).json({ message: 'Choose exactly one venue for this tournament' });
        }
        const selectedIds = [...new Set(venue_ids.map(Number))];
        if (selectedIds.some(id => !Number.isInteger(id) || id <= 0)) {
            return res.status(400).json({ message: 'Invalid venue selection' });
        }
        const selectedAvailabilityId = Number(availability_id);
        if (!Number.isInteger(selectedAvailabilityId) || selectedAvailabilityId <= 0) {
            return res.status(400).json({ message: 'Choose an available time slot for the selected venue' });
        }
        let connection;
        try {
            connection = await db.promise().getConnection();
            await connection.beginTransaction();
            const [tournaments] = await connection.query(
                `SELECT id, sport, start_date, end_date, match_start_time, match_end_time, match_duration_minutes
                 FROM tournaments WHERE id = ? AND (? = 'ADMIN' OR organizer_id = ?) FOR UPDATE`,
                [tournament_id, req.user.role, req.user.id]
            );
            if (!tournaments.length) {
                await connection.rollback();
                return res.status(404).json({ message: 'Tournament not found or access denied' });
            }
            const tournament = tournaments[0];
            if (!tournament.match_start_time || !tournament.match_end_time || tournament.match_duration_minutes == null) {
                await connection.rollback();
                return res.status(400).json({ message: 'Save the tournament scheduling configuration before selecting a venue' });
            }
            const [availabilityRows] = await connection.query(
                `SELECT v.id, va.id AS availability_id, va.start_time, va.end_time
                 FROM venues v JOIN venue_availability va ON va.venue_id = v.id
                 WHERE UPPER(TRIM(v.venue_type)) = ? AND (va.is_available = 1 OR va.is_available IS NULL)
                   AND va.available_date BETWEEN ? AND ?
                   AND v.id IN (?) AND va.id = ?`,
                [normalizedSport(tournament.sport), tournament.start_date, tournament.end_date, selectedIds, selectedAvailabilityId]
            );
            const chosenSlot = availabilityRows.find(row =>
                selectedIds.includes(Number(row.id)) && hasSchedulableSlot([row], tournament)
            );
            if (!chosenSlot) {
                await connection.rollback();
                return res.status(400).json({ message: 'The selected availability slot no longer matches this tournament schedule. Refresh the page and choose another slot.' });
            }
            await connection.query('DELETE FROM tournament_venues WHERE tournament_id = ?', [tournament_id]);
            await connection.query(
                'INSERT INTO tournament_venues (tournament_id, venue_id, availability_id) VALUES (?, ?, ?)',
                [tournament_id, Number(chosenSlot.id), selectedAvailabilityId]
            );
            await connection.commit();
            return res.status(200).json({ message: 'Tournament venue and availability saved', selectedVenueIds: [Number(chosenSlot.id)], availabilityId: selectedAvailabilityId });
        } catch (err) {
            if (connection) {
                try { await connection.rollback(); } catch (_) { /* transaction already closed */ }
            }
            console.error('Save tournament venues error:', err.message);
            return res.status(500).json({ message: 'Failed to save tournament venues' });
        } finally {
            if (connection) connection.release();
        }
    }
);

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
