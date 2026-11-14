const express = require('express');
const db = require('../config/db');
const { verifyToken, authorizeRole } = require('../middleware/auth');

const router = express.Router();

// Add Player to Team
// Add Player to Team
router.post(
    '/',
    verifyToken,
    authorizeRole('ORGANIZER', 'ADMIN', 'TEAM_CAPTAIN_PLAYER'),
    (req, res) => {
        const {
            team_id,
            player_name,
            jersey_number,
            player_position
        } = req.body;

        if (!team_id || !player_name) {
            return res.status(400).json({
                message: 'Team ID and Player Name are required'
            });
        }

        const sql = `
    INSERT INTO team_players
    (team_id, player_name, user_id, jersey_number, player_position)
    SELECT teams.id, ?, NULL, ?, ?
    FROM teams
    LEFT JOIN tournaments
        ON teams.tournament_id = tournaments.id
    WHERE teams.id = ?
    AND (
        ? = 'ADMIN'
        OR tournaments.organizer_id = ?
        OR teams.captain_id = ?
    )
`;

db.query(sql, [
    player_name,
    jersey_number || null,
    player_position || null,
    team_id,
    req.user.role,
    req.user.id,
    req.user.id
], (err, result) => {
    if (err) {
        console.error('Add player error:', err);
        return res.status(500).json({
            message: 'Failed to add player'
        });
    }

    if (result.affectedRows === 0) {
        return res.status(404).json({
            message: 'Team not found or access denied'
        });
    }

        res.status(201).json({
        message: 'Player added successfully',
        playerId: result.insertId
    });
        });
    }
);

// View Team Players
router.get(
    '/',
    verifyToken,
    authorizeRole('ORGANIZER', 'ADMIN', 'TEAM_CAPTAIN_PLAYER'),
    (req, res) => {
        const { team_id } = req.query;

        if (!team_id) {
            return res.status(400).json({
                message: 'Team ID is required'
            });
        }

        
            const sql = `
    SELECT
        team_players.*,
        COALESCE(NULLIF(team_players.player_name, ''), users.name) AS name,
        users.email
    FROM team_players
    JOIN teams ON team_players.team_id = teams.id
    JOIN tournaments ON teams.tournament_id = tournaments.id
    LEFT JOIN users ON team_players.user_id = users.id
            WHERE teams.id = ?
            AND (
                ? = 'ADMIN'
                OR tournaments.organizer_id = ?
                OR teams.captain_id = ?
            )
        `;

        db.query(sql, [
            team_id,
            req.user.role,
            req.user.id,
            req.user.id
        ], (err, results) => {
            if (err) {
                console.error('View players error:', err);
                return res.status(500).json({
                    message: 'Failed to fetch players'
                });
            }

            res.status(200).json({
                message: 'Players retrieved successfully',
                players: results
            });
        });
    }
);

// Update Player Information
router.put(
    '/:id',
    verifyToken,
    authorizeRole('ORGANIZER', 'ADMIN', 'TEAM_CAPTAIN_PLAYER'),
    (req, res) => {
        const { jersey_number, player_position } = req.body;

        const sql = `
            UPDATE team_players
            JOIN teams ON team_players.team_id = teams.id
            JOIN tournaments ON teams.tournament_id = tournaments.id
            SET team_players.jersey_number = ?,
                team_players.player_position = ?
            WHERE team_players.id = ?
            AND (
                ? = 'ADMIN'
                OR tournaments.organizer_id = ?
                OR teams.captain_id = ?
            )
        `;

        db.query(sql, [
            jersey_number || null,
            player_position || null,
            req.params.id,
            req.user.role,
            req.user.id,
            req.user.id
        ], (err, result) => {
            if (err) {
                console.error('Update player error:', err);
                return res.status(500).json({
                    message: 'Failed to update player'
                });
            }

            if (result.affectedRows === 0) {
                return res.status(404).json({
                    message: 'Player not found or access denied'
                });
            }

            res.status(200).json({
                message: 'Player updated successfully'
            });
        });
    }
);

// Remove Player from Team
router.delete(
    '/:id',
    verifyToken,
    authorizeRole('ORGANIZER', 'ADMIN', 'TEAM_CAPTAIN_PLAYER'),
    (req, res) => {
        const sql = `
            DELETE team_players
            FROM team_players
            JOIN teams ON team_players.team_id = teams.id
            JOIN tournaments ON teams.tournament_id = tournaments.id
            WHERE team_players.id = ?
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
                console.error('Delete player error:', err);
                return res.status(500).json({
                    message: 'Failed to remove player'
                });
            }

            if (result.affectedRows === 0) {
                return res.status(404).json({
                    message: 'Player not found or access denied'
                });
            }

            res.status(200).json({
                message: 'Player removed successfully'
            });
        });
    }
);

module.exports = router;