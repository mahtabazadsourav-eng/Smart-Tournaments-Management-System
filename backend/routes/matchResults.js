/**
 * Sprint 4 - Match results, result corrections, standings and knockout progression.
 */
'use strict';

const express = require('express');
const db = require('../config/db');
const { verifyToken, authorizeRole } = require('../middleware/auth');

const router = express.Router();
const organizerOrAdmin = [verifyToken, authorizeRole('ORGANIZER', 'ADMIN')];

function isPositiveInteger(value) {
    return Number.isInteger(Number(value)) && Number(value) > 0;
}

function parseScore(value) {
    if (value === null || value === undefined || value === '') return null;
    const score = Number(value);
    if (!Number.isFinite(score) || score < 0 || score > 1000000) return null;
    return score;
}

function getOutcome(team1Score, team2Score) {
    if (team1Score > team2Score) return 'TEAM1_WIN';
    if (team2Score > team1Score) return 'TEAM2_WIN';
    return 'DRAW';
}

function getWinnerId(fixture, outcome) {
    if (Number(fixture.is_bye) === 1) return Number(fixture.team1_id);
    if (outcome === 'TEAM1_WIN') return Number(fixture.team1_id);
    if (outcome === 'TEAM2_WIN') return Number(fixture.team2_id);
    return null;
}

async function getFixtureForUpdate(connection, fixtureId) {
    const [rows] = await connection.query(
        `SELECT f.id, f.tournament_id, f.round, f.team1_id, f.team2_id,
                f.is_bye, f.status, t.format AS tournament_format,
                t.organizer_id, t.name AS tournament_name,
                t1.team_name AS team1_name, t2.team_name AS team2_name
         FROM fixtures f
         JOIN tournaments t ON t.id = f.tournament_id
         JOIN teams t1 ON t1.id = f.team1_id
         LEFT JOIN teams t2 ON t2.id = f.team2_id
         WHERE f.id = ? FOR UPDATE`,
        [fixtureId]
    );
    return rows[0] || null;
}

function canManageTournament(user, fixture) {
    return user.role === 'ADMIN' || Number(fixture.organizer_id) === Number(user.id);
}

/**
 * If a feeder match winner changes, update the corresponding unplayed next-round
 * slot and clear its old schedule. Do not silently rewrite a match that already
 * has a result.
 */
async function syncWinnerToNextRound(connection, sourceFixtureId, winnerId) {
    const [links] = await connection.query(
        `SELECT target_fixture_id, source_fixture1_id, source_fixture2_id
         FROM fixture_bracket_links
         WHERE source_fixture1_id = ? OR source_fixture2_id = ?`,
        [sourceFixtureId, sourceFixtureId]
    );

    for (const link of links) {
        const targetId = Number(link.target_fixture_id);
        const targetColumn = Number(link.source_fixture1_id) === Number(sourceFixtureId)
            ? 'team1_id' : 'team2_id';
        const [targetRows] = await connection.query(
            `SELECT id, ${targetColumn} AS current_team_id FROM fixtures WHERE id = ? FOR UPDATE`,
            [targetId]
        );
        if (!targetRows.length || Number(targetRows[0].current_team_id) === Number(winnerId)) continue;

        const [playedRows] = await connection.query(
            'SELECT id FROM match_results WHERE fixture_id = ? LIMIT 1', [targetId]
        );
        if (playedRows.length) {
            const error = new Error('This result cannot be changed because the next-round match already has a result. Correct the later round first.');
            error.statusCode = 409;
            throw error;
        }

        await connection.query(
            `UPDATE fixtures
             SET ${targetColumn} = ?, match_date = NULL, match_start_time = NULL,
                 match_end_time = NULL, venue_id = NULL, status = 'UNSCHEDULED'
             WHERE id = ?`,
            [winnerId, targetId]
        );
    }
}

/**
 * Create the next knockout round once every fixture in the current final round
 * is decided. BYE fixtures advance their lone team automatically. Bracket links
 * retain feeder relationships so later score corrections can update open slots.
 */
async function advanceKnockoutBracket(connection, tournamentId) {
    const [tournamentRows] = await connection.query(
        'SELECT format FROM tournaments WHERE id = ? FOR UPDATE', [tournamentId]
    );
    if (!tournamentRows.length || tournamentRows[0].format !== 'KNOCKOUT') return null;

    await connection.query(
        `UPDATE fixtures
         SET status = 'COMPLETED'
         WHERE tournament_id = ? AND is_bye = 1 AND team2_id IS NULL
           AND status NOT IN ('COMPLETED', 'CANCELLED')`,
        [tournamentId]
    );

    const [maxRows] = await connection.query(
        'SELECT MAX(round) AS max_round FROM fixtures WHERE tournament_id = ?',
        [tournamentId]
    );
    const currentRound = Number(maxRows[0]?.max_round || 0);
    if (!currentRound) return null;

    const [roundRows] = await connection.query(
        `SELECT f.id, f.round, f.team1_id, f.team2_id, f.is_bye,
                mr.outcome
         FROM fixtures f
         LEFT JOIN match_results mr ON mr.fixture_id = f.id
         WHERE f.tournament_id = ? AND f.round = ?
         ORDER BY f.id FOR UPDATE`,
        [tournamentId, currentRound]
    );
    if (roundRows.length <= 1) return { completed_round: currentRound, final_round: true };

    const winners = [];
    for (const fixture of roundRows) {
        let winnerId = null;
        if (Number(fixture.is_bye) === 1 && fixture.team1_id) {
            winnerId = Number(fixture.team1_id);
        } else if (fixture.outcome === 'TEAM1_WIN') {
            winnerId = Number(fixture.team1_id);
        } else if (fixture.outcome === 'TEAM2_WIN') {
            winnerId = Number(fixture.team2_id);
        }
        if (!winnerId) return { completed_round: currentRound, advanced: false };
        winners.push({ fixtureId: Number(fixture.id), winnerId });
    }

    const [nextRows] = await connection.query(
        'SELECT id FROM fixtures WHERE tournament_id = ? AND round = ? ORDER BY id',
        [tournamentId, currentRound + 1]
    );
    if (nextRows.length) return { completed_round: currentRound, next_round_exists: true };

    const created = [];
    for (let index = 0; index < winners.length; index += 2) {
        const first = winners[index];
        const second = winners[index + 1];
        if (!second) break;
        const [insert] = await connection.query(
            `INSERT INTO fixtures
                (tournament_id, round, team1_id, team2_id, is_bye, status)
             VALUES (?, ?, ?, ?, 0, 'UNSCHEDULED')`,
            [tournamentId, currentRound + 1, first.winnerId, second.winnerId]
        );
        await connection.query(
            `INSERT INTO fixture_bracket_links
                (target_fixture_id, source_fixture1_id, source_fixture2_id)
             VALUES (?, ?, ?)`,
            [insert.insertId, first.fixtureId, second.fixtureId]
        );
        created.push(insert.insertId);
    }

    return { completed_round: currentRound, next_round: currentRound + 1, created_fixture_ids: created };
}

// GET /api/match-results?tournament_id=ID
router.get('/', ...organizerOrAdmin, async (req, res) => {
    const { tournament_id } = req.query;
    if (!isPositiveInteger(tournament_id)) {
        return res.status(400).json({ message: 'A valid tournament_id is required' });
    }
    try {
        let sql = `
            SELECT mr.id, mr.fixture_id, mr.team1_score, mr.team2_score, mr.outcome,
                   mr.recorded_at, mr.updated_at, u.name AS recorded_by_name,
                   f.round, f.match_date, f.match_start_time,
                   t.id AS tournament_id, t.name AS tournament_name, t.format AS tournament_format,
                   t1.id AS team1_id, t1.team_name AS team1_name,
                   t2.id AS team2_id, t2.team_name AS team2_name
            FROM match_results mr
            JOIN fixtures f ON f.id = mr.fixture_id
            JOIN tournaments t ON t.id = f.tournament_id
            JOIN teams t1 ON t1.id = f.team1_id
            JOIN teams t2 ON t2.id = f.team2_id
            LEFT JOIN users u ON u.id = mr.recorded_by
            WHERE t.id = ?`;
        const params = [Number(tournament_id)];
        if (req.user.role !== 'ADMIN') {
            sql += ' AND t.organizer_id = ?';
            params.push(Number(req.user.id));
        }
        sql += ' ORDER BY f.round, f.id';
        const [results] = await db.promise().query(sql, params);
        return res.json({ results, total: results.length });
    } catch (err) {
        console.error('List match results error:', err);
        return res.status(500).json({ message: 'Failed to load match results' });
    }
});

// GET /api/match-results/standings?tournament_id=ID
// Standings are computed from recorded results, so no duplicate standings table is needed.
router.get('/standings', ...organizerOrAdmin, async (req, res) => {
    const { tournament_id } = req.query;
    if (!isPositiveInteger(tournament_id)) {
        return res.status(400).json({ message: 'A valid tournament_id is required' });
    }
    try {
        const [tournaments] = await db.promise().query(
            'SELECT id, name, format, organizer_id FROM tournaments WHERE id = ?',
            [Number(tournament_id)]
        );
        if (!tournaments.length) return res.status(404).json({ message: 'Tournament not found' });
        const tournament = tournaments[0];
        if (req.user.role !== 'ADMIN' && Number(tournament.organizer_id) !== Number(req.user.id)) {
            return res.status(403).json({ message: 'Access denied' });
        }
        if (tournament.format === 'KNOCKOUT') {
            return res.status(400).json({ message: 'League standings are available for League and Group Stage tournaments. Use the knockout bracket for this tournament.' });
        }

        const [teams] = await db.promise().query(
            'SELECT id, team_name, group_name FROM teams WHERE tournament_id = ? ORDER BY group_name, team_name',
            [Number(tournament_id)]
        );
        const [matches] = await db.promise().query(
            `SELECT f.id, f.team1_id, f.team2_id, f.is_bye,
                    mr.team1_score, mr.team2_score, mr.outcome
             FROM fixtures f
             JOIN match_results mr ON mr.fixture_id = f.id
             WHERE f.tournament_id = ? AND f.status = 'COMPLETED' AND f.is_bye = 0`,
            [Number(tournament_id)]
        );

        const table = new Map();
        for (const team of teams) {
            table.set(Number(team.id), {
                team_id: Number(team.id), team_name: team.team_name,
                group_name: team.group_name || 'Overall', played: 0, won: 0, drawn: 0,
                lost: 0, goals_for: 0, goals_against: 0, goal_difference: 0, points: 0
            });
        }
        for (const match of matches) {
            const a = table.get(Number(match.team1_id));
            const b = table.get(Number(match.team2_id));
            if (!a || !b) continue;
            const scoreA = Number(match.team1_score);
            const scoreB = Number(match.team2_score);
            a.played++; b.played++;
            a.goals_for += scoreA; a.goals_against += scoreB;
            b.goals_for += scoreB; b.goals_against += scoreA;
            if (match.outcome === 'TEAM1_WIN') { a.won++; a.points += 3; b.lost++; }
            else if (match.outcome === 'TEAM2_WIN') { b.won++; b.points += 3; a.lost++; }
            else { a.drawn++; b.drawn++; a.points++; b.points++; }
        }
        const standings = [...table.values()].map(row => ({
            ...row, goal_difference: row.goals_for - row.goals_against
        })).sort((a, b) =>
            a.group_name.localeCompare(b.group_name) || b.points - a.points ||
            b.goal_difference - a.goal_difference || b.goals_for - a.goals_for ||
            a.team_name.localeCompare(b.team_name)
        );
        const groups = {};
        for (const row of standings) (groups[row.group_name] ||= []).push(row);
        return res.json({ tournament, standings, groups, matches_counted: matches.length });
    } catch (err) {
        console.error('Standings calculation error:', err);
        return res.status(500).json({ message: 'Failed to calculate standings' });
    }
});

// POST /api/match-results/advance - reconcile/advance a knockout bracket from saved results.
// Useful when results were recorded before the bracket-progression feature was installed.
router.post('/advance', ...organizerOrAdmin, async (req, res) => {
    const tournamentId = Number(req.body.tournament_id);
    if (!isPositiveInteger(tournamentId)) return res.status(400).json({ message: 'A valid tournament_id is required' });
    let connection;
    try {
        connection = await db.promise().getConnection();
        await connection.beginTransaction();
        const [rows] = await connection.query('SELECT id, format, organizer_id FROM tournaments WHERE id = ? FOR UPDATE', [tournamentId]);
        if (!rows.length) { await connection.rollback(); return res.status(404).json({ message: 'Tournament not found' }); }
        if (req.user.role !== 'ADMIN' && Number(rows[0].organizer_id) !== Number(req.user.id)) {
            await connection.rollback(); return res.status(403).json({ message: 'Access denied' });
        }
        if (rows[0].format !== 'KNOCKOUT') { await connection.rollback(); return res.status(400).json({ message: 'Bracket advancement is only available for knockout tournaments' }); }
        const bracket = await advanceKnockoutBracket(connection, tournamentId);
        await connection.commit();
        return res.json({ message: bracket?.created_fixture_ids?.length ? 'Knockout bracket advanced successfully' : 'No complete round is ready to advance', bracket });
    } catch (err) {
        if (connection) { try { await connection.rollback(); } catch (_) {} }
        console.error('Advance knockout bracket error:', err);
        return res.status(500).json({ message: 'Failed to advance knockout bracket. Confirm the Sprint 4 bracket migration has been applied.' });
    } finally {
        if (connection) connection.release();
    }
});

// POST /api/match-results - record a result and automatically advance knockout rounds.
router.post('/', ...organizerOrAdmin, async (req, res) => {
    const fixtureId = Number(req.body.fixture_id);
    const team1Score = parseScore(req.body.team1_score);
    const team2Score = parseScore(req.body.team2_score);
    if (!isPositiveInteger(fixtureId)) return res.status(400).json({ message: 'A valid fixture_id is required' });
    if (team1Score === null || team2Score === null) return res.status(400).json({ message: 'Both team scores must be valid non-negative numbers' });

    let connection;
    try {
        connection = await db.promise().getConnection();
        await connection.beginTransaction();
        const fixture = await getFixtureForUpdate(connection, fixtureId);
        if (!fixture) { await connection.rollback(); return res.status(404).json({ message: 'Fixture not found' }); }
        if (!canManageTournament(req.user, fixture)) { await connection.rollback(); return res.status(403).json({ message: 'Access denied' }); }
        if (Number(fixture.is_bye) === 1 || !fixture.team2_id) { await connection.rollback(); return res.status(409).json({ message: 'A BYE fixture does not accept a match result' }); }
        if (fixture.status !== 'SCHEDULED') { await connection.rollback(); return res.status(409).json({ message: 'Only scheduled fixtures can receive a new result' }); }
        const [existing] = await connection.query('SELECT id FROM match_results WHERE fixture_id = ?', [fixtureId]);
        if (existing.length) { await connection.rollback(); return res.status(409).json({ message: 'A result already exists. Use Update Match Result.' }); }

        const outcome = getOutcome(team1Score, team2Score);
        if (fixture.tournament_format === 'KNOCKOUT' && outcome === 'DRAW') {
            await connection.rollback();
            return res.status(422).json({ message: 'Knockout matches cannot end in a draw. Enter the final score after any tie-break.' });
        }
        const [insert] = await connection.query(
            `INSERT INTO match_results (fixture_id, team1_score, team2_score, outcome, recorded_by)
             VALUES (?, ?, ?, ?, ?)`,
            [fixtureId, team1Score, team2Score, outcome, Number(req.user.id)]
        );
        await connection.query("UPDATE fixtures SET status = 'COMPLETED' WHERE id = ?", [fixtureId]);
        let bracket = null;
        if (fixture.tournament_format === 'KNOCKOUT') {
            const winnerId = getWinnerId(fixture, outcome);
            await syncWinnerToNextRound(connection, fixtureId, winnerId);
            bracket = await advanceKnockoutBracket(connection, Number(fixture.tournament_id));
        }
        await connection.commit();
        return res.status(201).json({
            message: 'Match result saved successfully',
            result: { id: insert.insertId, fixture_id: fixtureId, team1_id: fixture.team1_id,
                team1_name: fixture.team1_name, team1_score: team1Score, team2_id: fixture.team2_id,
                team2_name: fixture.team2_name, team2_score: team2Score, outcome, fixture_status: 'COMPLETED' },
            bracket
        });
    } catch (err) {
        if (connection) { try { await connection.rollback(); } catch (_) {} }
        console.error('Record match result error:', err);
        return res.status(err.statusCode || 500).json({ message: err.statusCode ? err.message : 'Failed to save match result' });
    } finally {
        if (connection) connection.release();
    }
});

// PUT /api/match-results/:fixtureId - update an existing result.
router.put('/:fixtureId', ...organizerOrAdmin, async (req, res) => {
    const fixtureId = Number(req.params.fixtureId);
    const team1Score = parseScore(req.body.team1_score);
    const team2Score = parseScore(req.body.team2_score);
    if (!isPositiveInteger(fixtureId)) return res.status(400).json({ message: 'A valid fixture ID is required' });
    if (team1Score === null || team2Score === null) return res.status(400).json({ message: 'Both team scores must be valid non-negative numbers' });

    let connection;
    try {
        connection = await db.promise().getConnection();
        await connection.beginTransaction();
        const fixture = await getFixtureForUpdate(connection, fixtureId);
        if (!fixture) { await connection.rollback(); return res.status(404).json({ message: 'Fixture not found' }); }
        if (!canManageTournament(req.user, fixture)) { await connection.rollback(); return res.status(403).json({ message: 'Access denied' }); }
        const [existing] = await connection.query('SELECT id FROM match_results WHERE fixture_id = ? FOR UPDATE', [fixtureId]);
        if (!existing.length) { await connection.rollback(); return res.status(404).json({ message: 'No saved result exists for this fixture' }); }
        const outcome = getOutcome(team1Score, team2Score);
        if (fixture.tournament_format === 'KNOCKOUT' && outcome === 'DRAW') {
            await connection.rollback();
            return res.status(422).json({ message: 'Knockout matches cannot end in a draw. Enter the final score after any tie-break.' });
        }
        await connection.query(
            `UPDATE match_results SET team1_score = ?, team2_score = ?, outcome = ? WHERE fixture_id = ?`,
            [team1Score, team2Score, outcome, fixtureId]
        );
        await connection.query("UPDATE fixtures SET status = 'COMPLETED' WHERE id = ?", [fixtureId]);
        let bracket = null;
        if (fixture.tournament_format === 'KNOCKOUT') {
            await syncWinnerToNextRound(connection, fixtureId, getWinnerId(fixture, outcome));
            bracket = await advanceKnockoutBracket(connection, Number(fixture.tournament_id));
        }
        await connection.commit();
        return res.json({ message: 'Match result updated successfully', fixture_id: fixtureId,
            team1_score: team1Score, team2_score: team2Score, outcome, bracket });
    } catch (err) {
        if (connection) { try { await connection.rollback(); } catch (_) {} }
        console.error('Update match result error:', err);
        return res.status(err.statusCode || 500).json({ message: err.statusCode ? err.message : 'Failed to update match result' });
    } finally {
        if (connection) connection.release();
    }
});

module.exports = router;
