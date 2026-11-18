const express = require('express');
const db = require('../config/db');
const { verifyToken, authorizeRole } = require('../middleware/auth');

const router = express.Router();

// Add Team Availability
router.post(
    '/',
    verifyToken,
    authorizeRole('ADMIN', 'ORGANIZER', 'TEAM_CAPTAIN_PLAYER'),
    (req, res) => {
        const {
            team_id,
            available_date,
            start_time,
            end_time
        } = req.body;

        if (!team_id || !available_date || !start_time || !end_time) {
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
            INSERT INTO team_availability
            (team_id, available_date, start_time, end_time)
            SELECT teams.id, ?, ?, ?
            FROM teams
            JOIN tournaments ON teams.tournament_id = tournaments.id
            WHERE teams.id = ?
            AND (
                ? = 'ADMIN'
                OR tournaments.organizer_id = ?
                OR teams.captain_id = ?
            )
        `;

        db.query(sql, [
            available_date,
            start_time,
            end_time,
            team_id,
            req.user.role,
            req.user.id,
            req.user.id
        ], (err, result) => {
            if (err) {
                console.error('Add team availability error:', err);
                return res.status(500).json({
                    message: 'Failed to add team availability'
                });
            }

            if (result.affectedRows === 0) {
                return res.status(404).json({
                    message: 'Team not found or access denied'
                });
            }

            res.status(201).json({
                message: 'Team availability added successfully',
                availabilityId: result.insertId
            });
        });
    }
);

// View Team Availability
router.get(
    '/',
    verifyToken,
    authorizeRole('ADMIN', 'ORGANIZER', 'TEAM_CAPTAIN_PLAYER', 'PLAYER'),
    (req, res) => {
        const { team_id } = req.query;

        let sql = `
            SELECT team_availability.*, teams.team_name
            FROM team_availability
            JOIN teams ON team_availability.team_id = teams.id
            JOIN tournaments ON teams.tournament_id = tournaments.id
            WHERE 1 = 1
        `;

        const params = [];

        if (req.user.role === 'ORGANIZER') {
            sql += ' AND tournaments.organizer_id = ?';
            params.push(req.user.id);
        } else if (req.user.role === 'TEAM_CAPTAIN_PLAYER') {
            sql += ' AND teams.captain_id = ?';
            params.push(req.user.id);
        } else if (req.user.role === 'PLAYER') {
            sql += ` AND EXISTS (
                SELECT 1 FROM player_team_memberships membership
                WHERE membership.team_id = teams.id AND membership.user_id = ?
            )`;
            params.push(req.user.id);
        }

        if (team_id) {
            sql += ' AND team_availability.team_id = ?';
            params.push(team_id);
        }

        sql += ' ORDER BY available_date, start_time';

        db.query(sql, params, (err, results) => {
            if (err) {
                console.error('View team availability error:', err);
                return res.status(500).json({
                    message: 'Failed to retrieve team availability'
                });
            }

            res.status(200).json({
                message: 'Team availability retrieved successfully',
                availability: results
            });
        });
    }
);

// Update Team Availability
router.put(
    '/:id',
    verifyToken,
    authorizeRole('ADMIN', 'ORGANIZER', 'TEAM_CAPTAIN_PLAYER'),
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
            UPDATE team_availability
            JOIN teams ON team_availability.team_id = teams.id
            JOIN tournaments ON teams.tournament_id = tournaments.id
            SET
                available_date = ?,
                start_time = ?,
                end_time = ?,
                is_available = ?
            WHERE team_availability.id = ?
            AND (
                ? = 'ADMIN'
                OR tournaments.organizer_id = ?
                OR teams.captain_id = ?
            )
        `;

        db.query(sql, [
            available_date,
            start_time,
            end_time,
            is_available,
            req.params.id,
            req.user.role,
            req.user.id,
            req.user.id
        ], (err, result) => {
            if (err) {
                console.error('Update team availability error:', err);
                return res.status(500).json({
                    message: 'Failed to update team availability'
                });
            }

            if (result.affectedRows === 0) {
                return res.status(404).json({
                    message: 'Availability not found or access denied'
                });
            }

            res.status(200).json({
                message: 'Team availability updated successfully'
            });
        });
    }
);

// Delete Team Availability
router.delete(
    '/:id',
    verifyToken,
    authorizeRole('ADMIN', 'ORGANIZER', 'TEAM_CAPTAIN_PLAYER'),
    (req, res) => {
        const sql = `
            DELETE team_availability
            FROM team_availability
            JOIN teams ON team_availability.team_id = teams.id
            JOIN tournaments ON teams.tournament_id = tournaments.id
            WHERE team_availability.id = ?
            AND (
                ? = 'ADMIN'
                OR tournaments.organizer_id = ?
                OR teams.captain_id = ?
            )
        `;

        db.query(sql, [
            req.params.id,
            req.user.role,
            req.user.id,
            req.user.id
        ], (err, result) => {
            if (err) {
                console.error('Delete team availability error:', err);
                return res.status(500).json({
                    message: 'Failed to delete team availability'
                });
            }

            if (result.affectedRows === 0) {
                return res.status(404).json({
                    message: 'Availability not found or access denied'
                });
            }

            res.status(200).json({
                message: 'Team availability deleted successfully'
            });
        });
    }
);

module.exports = router;
