
const express = require('express');
const db = require('../config/db');
const { verifyToken, authorizeRole } = require('../middleware/auth');

const router = express.Router();

// Add Team API
router.post(
    '/',
    verifyToken,
    authorizeRole('ORGANIZER', 'ADMIN'),
    (req, res) => {

        const { tournament_id, team_name, captain_id } = req.body;

        if (!tournament_id || !team_name) {
            return res.status(400).json({
                message: 'Tournament ID and team name are required'
            });
        }

        const sql = `
            INSERT INTO teams (tournament_id, team_name, captain_id)
            SELECT id, ?, ?
            FROM tournaments
            WHERE id = ?
            AND (? = 'ADMIN' OR organizer_id = ?)
        `;

        db.query(
            sql,
            [
                team_name,
                captain_id || null,
                tournament_id,
                req.user.role,
                req.user.id
            ],
            (err, result) => {

                if (err) {
                    console.error('Add team error:', err);

                    return res.status(500).json({
                        message: 'Failed to add team'
                    });
                }

                if (result.affectedRows === 0) {
                    return res.status(404).json({
                        message: 'Tournament not found or access denied'
                    });
                }

                res.status(201).json({
                    message: 'Team added successfully',
                    teamId: result.insertId
                });
            }
        );
    }
);

// View Teams API
router.get(
    '/',
    verifyToken,
    authorizeRole('ORGANIZER', 'ADMIN', 'TEAM_CAPTAIN_PLAYER'),
    (req, res) => {

        const { tournament_id } = req.query;

        if (!tournament_id) {
            return res.status(400).json({
                message: 'Tournament ID is required'
            });
        }

        const isAdmin = req.user.role === 'ADMIN';
        const isCaptain = req.user.role === 'TEAM_CAPTAIN_PLAYER';

        let sql = `
            SELECT teams.*
            FROM teams
            JOIN tournaments
                ON teams.tournament_id = tournaments.id
            WHERE teams.tournament_id = ?
        `;

        let values = [tournament_id];

        if (!isAdmin && !isCaptain) {
            sql += ` AND tournaments.organizer_id = ?`;
            values.push(req.user.id);
        }

        db.query(sql, values, (err, results) => {

            if (err) {
                console.error('View teams error:', err);

                return res.status(500).json({
                    message: 'Failed to fetch teams'
                });
            }

            res.status(200).json({
                message: 'Teams retrieved successfully',
                teams: results
            });
        });
    }
);

// Update Team API
router.put(
    '/:id',
    verifyToken,
    authorizeRole('ORGANIZER', 'ADMIN'),
    (req, res) => {

        const { team_name, captain_id } = req.body;

        if (!team_name) {
            return res.status(400).json({
                message: 'Team name is required'
            });
        }

        const isAdmin = req.user.role === 'ADMIN';

        const sql = isAdmin
            ? `UPDATE teams
               SET team_name = ?, captain_id = ?
               WHERE id = ?`
            : `UPDATE teams
               JOIN tournaments
               ON teams.tournament_id = tournaments.id
               SET teams.team_name = ?, teams.captain_id = ?
               WHERE teams.id = ?
               AND tournaments.organizer_id = ?`;

        const values = isAdmin
            ? [team_name, captain_id || null, req.params.id]
            : [team_name, captain_id || null, req.params.id, req.user.id];

        db.query(sql, values, (err, result) => {

            if (err) {
                console.error('Update team error:', err);

                return res.status(500).json({
                    message: 'Failed to update team'
                });
            }

            if (result.affectedRows === 0) {
                return res.status(404).json({
                    message: 'Team not found or access denied'
                });
            }

            res.status(200).json({
                message: 'Team updated successfully'
            });
        });
    }
);

// Delete Team API
router.delete(
    '/:id',
    verifyToken,
    authorizeRole('ORGANIZER', 'ADMIN'),
    (req, res) => {

        const isAdmin = req.user.role === 'ADMIN';

        const sql = isAdmin
            ? `DELETE FROM teams WHERE id = ?`
            : `DELETE teams FROM teams
               JOIN tournaments
               ON teams.tournament_id = tournaments.id
               WHERE teams.id = ?
               AND tournaments.organizer_id = ?`;

        const values = isAdmin
            ? [req.params.id]
            : [req.params.id, req.user.id];

        db.query(sql, values, (err, result) => {

            if (err) {
                console.error('Delete team error:', err);

                return res.status(500).json({
                    message: 'Failed to delete team'
                });
            }

            if (result.affectedRows === 0) {
                return res.status(404).json({
                    message: 'Team not found or access denied'
                });
            }

            res.status(200).json({
                message: 'Team deleted successfully'
            });
        });
    }
);

module.exports = router;
