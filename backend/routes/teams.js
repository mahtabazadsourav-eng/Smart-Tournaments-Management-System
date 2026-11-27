
const express = require('express');
const db = require('../config/db');
const { verifyToken, authorizeRole } = require('../middleware/auth');

const router = express.Router();

// Team choices shown on the public player sign-up form.
router.get('/available', (req, res) => {
    db.query(`SELECT teams.id, teams.team_name, teams.group_name, teams.tournament_id, tournaments.name AS tournament_name,
                     tournaments.sport, tournaments.format, tournaments.start_date, tournaments.end_date
              FROM teams JOIN tournaments ON tournaments.id = teams.tournament_id
              ORDER BY tournaments.name, teams.team_name`, (err, results) => {
        if (err) return res.status(500).json({ message: 'Failed to fetch available teams' });
        res.status(200).json({ teams: results });
    });
});

// Add Team API
router.post(
    '/',
    verifyToken,
    authorizeRole('ORGANIZER', 'ADMIN'),
    (req, res) => {
        const { tournament_id, team_name, group_name } = req.body;

        if (!tournament_id || !team_name) {
            return res.status(400).json({
                message: 'Tournament ID and team name are required'
            });
        }
        const normalizedGroup = String(group_name || '').trim();
        if (normalizedGroup.length > 100) {
            return res.status(400).json({ message: 'Group name must be 100 characters or fewer' });
        }

        const sql = `
            INSERT INTO teams (tournament_id, team_name, group_name)
            SELECT id, ?, ?
            FROM tournaments
            WHERE id = ?
            AND (? = 'ADMIN' OR organizer_id = ?)
            AND (format <> 'GROUP_STAGE' OR ? <> '')
        `;

        db.query(sql, [
            team_name,
            normalizedGroup || null,
            tournament_id,
            req.user.role,
            req.user.id,
            normalizedGroup
        ], (err, result) => {
            if (err) {
                console.error('Add team error:', err);
                return res.status(500).json({
                    message: 'Failed to add team'
                });
            }

            if (result.affectedRows === 0) {
                if (!normalizedGroup) {
                    return res.status(400).json({ message: 'Group name is required for Group Stage tournaments' });
                }
                return res.status(404).json({
                    message: 'Tournament not found or access denied'
                });
            }

            res.status(201).json({
                message: 'Team added successfully',
                teamId: result.insertId
            });
        });
    }
);

// View Teams API
router.get(
    '/',
    verifyToken,
    authorizeRole('ORGANIZER', 'ADMIN', 'TEAM_CAPTAIN_PLAYER', 'PLAYER'),
    (req, res) => {
        const { tournament_id } = req.query;

        if (req.user.role === 'PLAYER') {
            if (!tournament_id) {
                return res.status(400).json({ message: 'Tournament ID is required' });
            }
            const sql = `SELECT teams.*, tournaments.name AS tournament_name,
                                tournaments.sport, tournaments.format,
                                tournaments.start_date, tournaments.end_date
                         FROM teams JOIN tournaments ON tournaments.id = teams.tournament_id
                         WHERE teams.tournament_id = ?
                         ORDER BY teams.team_name`;
            return db.query(sql, [tournament_id], (err, results) => {
                if (err) {
                    console.error('View tournament teams error:', err);
                    return res.status(500).json({ message: 'Failed to fetch teams' });
                }
                return res.status(200).json({ message: 'Teams retrieved successfully', teams: results });
            });
        }

        if (req.user.role === 'TEAM_CAPTAIN_PLAYER') {
            const sql = `SELECT teams.*, tournaments.name AS tournament_name,
                                tournaments.sport, tournaments.format,
                                tournaments.start_date, tournaments.end_date
                         FROM teams JOIN tournaments ON tournaments.id = teams.tournament_id
                         WHERE (teams.captain_id = ? OR EXISTS (
                             SELECT 1 FROM player_team_memberships membership
                             WHERE membership.team_id = teams.id AND membership.user_id = ?
                         ) OR EXISTS (
                             SELECT 1 FROM team_players captain_membership
                             WHERE captain_membership.team_id = teams.id AND captain_membership.user_id = ?
                         ))
                         ${tournament_id ? ' AND teams.tournament_id = ?' : ''}`;
            const values = tournament_id
                ? [req.user.id, req.user.id, req.user.id, tournament_id]
                : [req.user.id, req.user.id, req.user.id];
            db.query(sql, values, (err, results) => {
                if (err) {
                    console.error('View captain teams error:', err);
                    return res.status(500).json({ message: 'Failed to fetch teams' });
                }
                return res.status(200).json({ message: 'Teams retrieved successfully', teams: results });
            });
        }

        if (!tournament_id) {
            return res.status(400).json({
                message: 'Tournament ID is required'
            });
        }

        const isAdmin = req.user.role === 'ADMIN';

        const sql = isAdmin
            ? `SELECT * FROM teams WHERE tournament_id = ?`
            : `SELECT teams.*
               FROM teams
               JOIN tournaments ON teams.tournament_id = tournaments.id
               WHERE teams.tournament_id = ?
               AND tournaments.organizer_id = ?`;

        const values = isAdmin
            ? [tournament_id]
            : [tournament_id, req.user.id];

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
        const { team_name, group_name } = req.body;

        if (!team_name) {
            return res.status(400).json({
                message: 'Team name is required'
            });
        }

        const isAdmin = req.user.role === 'ADMIN';

        const sql = isAdmin
            ? `UPDATE teams
               SET team_name = ?, group_name = COALESCE(?, group_name)
               WHERE id = ?`
            : `UPDATE teams
               JOIN tournaments
               ON teams.tournament_id = tournaments.id
               SET teams.team_name = ?, teams.group_name = COALESCE(?, teams.group_name)
               WHERE teams.id = ?
               AND tournaments.organizer_id = ?`;

        const values = isAdmin
            ? [team_name, String(group_name || '').trim() || null, req.params.id]
            : [team_name, String(group_name || '').trim() || null, req.params.id, req.user.id];

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
