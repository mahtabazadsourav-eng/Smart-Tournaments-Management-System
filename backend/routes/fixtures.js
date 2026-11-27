/**
 * routes/fixtures.js  — Sprint 3
 *
 * Endpoints:
 *   POST /api/fixtures/generate   — Generate Knockout or Round-Robin fixtures
 *   POST /api/fixtures/schedule   — Auto-assign dates, times & venues
 *   GET  /api/fixtures            — List all fixtures for a tournament (with names)
 *   GET  /api/fixtures/plan       — Complete tournament plan grouped by round
 *   GET  /api/fixtures/conflicts  — Conflict report (venue/team overlaps, rest-time)
 */

'use strict';

const express = require('express');
const db      = require('../config/db');
const { verifyToken, authorizeRole } = require('../middleware/auth');

const router = express.Router();

// ─── Utility helpers ──────────────────────────────────────────────────────────

/**
 * Convert a "HH:MM:SS" or "HH:MM" string to total minutes since midnight.
 */
function timeToMinutes(t) {
    if (!t) return null;
    const parts = t.split(':').map(Number);
    return parts[0] * 60 + parts[1]; // ignore seconds for scheduling purposes
}

/**
 * Add `mins` minutes to a "HH:MM:SS" time string.
 * Returns "HH:MM:SS".
 */
function addMinutes(timeStr, mins) {
    const total = timeToMinutes(timeStr) + mins;
    const h = Math.floor(total / 60) % 24;
    const m = total % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
}

/**
 * Format a JS Date to "YYYY-MM-DD".
 */
function formatDate(d) {
    if (typeof d === 'string') return d.slice(0, 10);
    return d.toISOString().split('T')[0];
}

/**
 * Enumerate all dates between start and end inclusive.
 */
function dateRange(startStr, endStr) {
    const dates = [];
    const cur = new Date(`${formatDate(startStr)}T00:00:00.000Z`);
    const end = new Date(`${formatDate(endStr)}T00:00:00.000Z`);
    while (cur <= end) {
        dates.push(cur.toISOString().slice(0, 10));
        cur.setUTCDate(cur.getUTCDate() + 1);
    }
    return dates;
}

/**
 * Fischer-Yates shuffle (in-place).
 */
function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

/**
 * Generate Round-Robin fixture pairs using the standard polygon rotation algorithm.
 * Returns [ { team1_id, team2_id, round } ].
 * round is 1-indexed.
 */
function generateRoundRobinPairs(teams) {
    const list   = [...teams];
    const hasBye = list.length % 2 !== 0;
    if (hasBye) list.push(null); // phantom BYE team

    const n       = list.length;
    const rounds  = n - 1;
    const pairs   = [];

    for (let r = 0; r < rounds; r++) {
        for (let i = 0; i < n / 2; i++) {
            const t1 = list[i];
            const t2 = list[n - 1 - i];
            if (t1 !== null && t2 !== null) {
                pairs.push({ team1_id: t1.id, team2_id: t2.id, round: r + 1 });
            }
        }
        // Rotate all elements except the first
        const last = list.splice(n - 1, 1)[0];
        list.splice(1, 0, last);
    }

    return pairs;
}

// ─── Promisified db.query ─────────────────────────────────────────────────────

function query(sql, params, executor = db) {
    // mysql2's promise connection ignores callback arguments; use its returned
    // promise for transaction queries and the callback API for the shared pool.
    if (executor !== db) {
        return executor.query(sql, params).then(([result]) => result);
    }
    return new Promise((resolve, reject) => {
        executor.query(sql, params, (err, result) => {
            if (err) return reject(err);
            resolve(result);
        });
    });
}

// =============================================================================
// POST /api/fixtures/generate
// Generate Knockout or Round-Robin fixtures for a tournament.
// Clears existing fixtures first.
// =============================================================================
router.post(
    '/generate',
    verifyToken,
    authorizeRole('ORGANIZER', 'ADMIN'),
    async (req, res) => {
        const { tournament_id } = req.body;

        if (!tournament_id) {
            return res.status(400).json({ message: 'tournament_id is required' });
        }

        try {
            // 1. Fetch tournament
            const tRows = await query(
                `SELECT id, name, format, organizer_id
                 FROM tournaments WHERE id = ?`,
                [tournament_id]
            );

            if (tRows.length === 0) {
                return res.status(404).json({ message: 'Tournament not found' });
            }

            const tournament = tRows[0];

            // Organizer can only manage their own tournaments
            if (
                req.user.role === 'ORGANIZER' &&
                Number(tournament.organizer_id) !== Number(req.user.id)
            ) {
                return res.status(403).json({ message: 'Access denied' });
            }

            // 2. Fetch teams for tournament
            const teams = await query(
                `SELECT id, team_name, group_name FROM teams WHERE tournament_id = ?`,
                [tournament_id]
            );

            if (teams.length < 2) {
                return res.status(400).json({
                    message: 'At least 2 teams are required to generate fixtures'
                });
            }

            // 3. Build fixture list
            const format   = tournament.format; // 'KNOCKOUT' | 'LEAGUE' | 'GROUP_STAGE'
            const fixtures = [];

            if (format === 'KNOCKOUT') {
                // Seed a complete first-round bracket; teams with a bye occupy a
                // match slot alone so the advancing field is a power of two.
                const shuffled = shuffle([...teams]);
                const bracketSize = 2 ** Math.ceil(Math.log2(shuffled.length));
                const openingMatches = bracketSize / 2;
                const byeCount = bracketSize - shuffled.length;
                let teamIndex = 0;
                for (let i = 0; i < openingMatches; i++) {
                    const isBye = i < byeCount;
                    const t1 = shuffled[teamIndex++];
                    const t2 = isBye ? null : shuffled[teamIndex++];
                    fixtures.push({
                        tournament_id,
                        round: 1,
                        team1_id : t1.id,
                        team2_id : isBye ? null : t2.id,
                        is_bye   : isBye ? 1 : 0
                    });
                }
            } else if (format === 'GROUP_STAGE') {
                const groups = new Map();
                for (const team of teams) {
                    const groupName = String(team.group_name || '').trim();
                    if (!groupName) {
                        return res.status(400).json({
                            message: `Assign a Group Name to every team before generating Group Stage fixtures (missing for ${team.team_name})`
                        });
                    }
                    const key = groupName.toLocaleLowerCase();
                    if (!groups.has(key)) groups.set(key, { name: groupName, teams: [] });
                    groups.get(key).teams.push(team);
                }
                const smallGroups = [...groups.values()].filter(group => group.teams.length < 2);
                if (smallGroups.length) {
                    return res.status(400).json({
                        message: `Each group needs at least 2 teams to generate fixtures. Add another team to: ${smallGroups.map(group => group.name).join(', ')}`
                    });
                }
                for (const group of groups.values()) {
                    for (const pair of generateRoundRobinPairs(group.teams)) {
                        fixtures.push({
                            tournament_id,
                            round: pair.round,
                            team1_id: pair.team1_id,
                            team2_id: pair.team2_id,
                            is_bye: 0,
                            group_name: group.name,
                        });
                    }
                }
            } else {
                // League: round-robin across all tournament teams.
                const pairs = generateRoundRobinPairs(teams);
                pairs.forEach(p => {
                    fixtures.push({
                        tournament_id,
                        round    : p.round,
                        team1_id : p.team1_id,
                        team2_id : p.team2_id,
                        is_bye   : 0
                    });
                });
            }

            // 4. Replace fixtures atomically so a failed generation preserves
            // the previously saved schedule.
            if (fixtures.length === 0) {
                return res.status(400).json({ message: 'No fixtures could be generated' });
            }

            const insertValues = fixtures.map(f => [
                f.tournament_id,
                f.round,
                f.team1_id,
                f.team2_id,
                f.is_bye
            ]);

            const connection = await db.promise().getConnection();
            let result;
            try {
                await connection.beginTransaction();
                await query(`DELETE FROM fixtures WHERE tournament_id = ?`, [tournament_id], connection);
                // Build explicit row placeholders. This avoids driver/version
                // differences when expanding a nested array after VALUES.
                const rowPlaceholders = insertValues.map(() => '(?, ?, ?, ?, ?)').join(', ');
                await query(
                    `INSERT INTO fixtures (tournament_id, round, team1_id, team2_id, is_bye)
                     VALUES ${rowPlaceholders}`,
                    insertValues.flat(),
                    connection
                );
                result = await query(
                     `SELECT f.*, t1.team_name AS team1_name, t2.team_name AS team2_name,
                             t1.group_name AS team1_group, t2.group_name AS team2_group
                     FROM fixtures f
                     JOIN teams t1 ON f.team1_id = t1.id
                     LEFT JOIN teams t2 ON f.team2_id = t2.id
                     WHERE f.tournament_id = ?
                     ORDER BY f.round, f.id`,
                    [tournament_id],
                    connection
                );
                await connection.commit();
            } catch (generationError) {
                // Preserve the original SQL error if rollback itself fails.
                try {
                    await connection.rollback();
                } catch (rollbackError) {
                    console.error('Fixture generation rollback error:', rollbackError);
                }
                throw generationError;
            } finally {
                connection.release();
            }

            return res.status(201).json({
                message  : `${format === 'KNOCKOUT' ? 'Knockout' : format === 'GROUP_STAGE' ? 'Group Stage' : 'Round-Robin'} fixtures generated successfully`,
                data     : result,
                fixtures : result,
                totalFixtures: result.length
            });

        } catch (err) {
            console.error('Generate fixtures error:', err);
            return res.status(500).json({
                message: 'Failed to generate fixtures',
                ...(process.env.NODE_ENV !== 'production' ? { detail: err.message } : {})
            });
        }
    }
);

// =============================================================================
// POST /api/fixtures/schedule
// Auto-assign match dates, times, and venues to unscheduled fixtures.
// =============================================================================
router.post(
    '/schedule',
    verifyToken,
    authorizeRole('ORGANIZER', 'ADMIN'),
    async (req, res) => {
        const { tournament_id } = req.body;

        if (!tournament_id) {
            return res.status(400).json({ message: 'tournament_id is required' });
        }

        try {
            // 1. Fetch tournament details
            const tRows = await query(
                `SELECT id, name, sport, format, organizer_id,
                        start_date, end_date,
                        match_start_time, match_end_time,
                        match_duration_minutes, minimum_rest_minutes
                 FROM tournaments WHERE id = ?`,
                [tournament_id]
            );

            if (tRows.length === 0) {
                return res.status(404).json({ message: 'Tournament not found' });
            }

            const t = tRows[0];

            if (req.user.role === 'ORGANIZER' && Number(t.organizer_id) !== Number(req.user.id)) {
                return res.status(403).json({ message: 'Access denied' });
            }

            if (
                !t.start_date || !t.end_date ||
                !t.match_start_time || !t.match_end_time ||
                t.match_duration_minutes == null ||
                t.minimum_rest_minutes == null
            ) {
                return res.status(400).json({
                    message: 'Tournament scheduling config is incomplete. Set start/end dates and match time settings first.'
                });
            }

            const durationMins = Number(t.match_duration_minutes);
            const restMins     = Number(t.minimum_rest_minutes);
            const tourneyStart = timeToMinutes(t.match_start_time);
            const tourneyEnd   = timeToMinutes(t.match_end_time);

            // 2. Fetch unscheduled fixtures (excluding BYEs)
            const fixtures = await query(
                `SELECT f.*, t1.team_name AS team1_name, t2.team_name AS team2_name
                 FROM fixtures f
                 JOIN teams t1 ON f.team1_id = t1.id
                 LEFT JOIN teams t2 ON f.team2_id = t2.id
                 WHERE f.tournament_id = ?
                   AND f.match_date IS NULL
                   AND f.is_bye = 0
                 ORDER BY f.round, f.id`,
                [tournament_id]
            );

            if (fixtures.length === 0) {
                return res.status(200).json({
                    message : 'No unscheduled fixtures found',
                    data    : { scheduled: [], unscheduled: [], warnings: [] }
                });
            }

            const selectedVenueRows = await query(
                'SELECT venue_id, availability_id FROM tournament_venues WHERE tournament_id = ?',
                [tournament_id]
            );
            const selectedVenueIds = selectedVenueRows.map(row => row.venue_id);
            if (selectedVenueIds.length !== 1) {
                return res.status(400).json({ message: 'Select exactly one available venue for this tournament before auto-scheduling' });
            }
            const selectedAvailabilityId = Number(selectedVenueRows[0].availability_id);
            if (!Number.isInteger(selectedAvailabilityId) || selectedAvailabilityId <= 0) {
                return res.status(400).json({ message: 'Choose a matching venue availability slot again before auto-scheduling' });
            }

            // 3. Fetch venue availability for venues of this sport
            const venueAvailability = await query(
                `SELECT va.id, va.venue_id, va.available_date, va.start_time, va.end_time,
                        v.venue_name, v.venue_type
                 FROM venue_availability va
                 JOIN venues v ON va.venue_id = v.id
                 WHERE (va.is_available = 1 OR va.is_available IS NULL)
                   AND v.venue_type = ?
                   AND v.id IN (?) AND va.id = ?
                 ORDER BY va.available_date, va.start_time`,
                [t.sport, selectedVenueIds, selectedAvailabilityId]
            );

            // 4. Build lookup maps for fast checking
            // venueSlots: { "venueId_date" => [{start_min, end_min, venue_id, venue_name}] }
            const venueSlots = {};
            for (const va of venueAvailability) {
                const key = `${va.venue_id}_${formatDate(va.available_date)}`;
                if (!venueSlots[key]) venueSlots[key] = [];
                venueSlots[key].push({
                    venue_id  : va.venue_id,
                    venue_name: va.venue_name,
                    start_min : timeToMinutes(va.start_time),
                    end_min   : timeToMinutes(va.end_time)
                });
            }

            // Track scheduled assignments in-memory to avoid conflicts within this run
            // bookedVenues: { "venueId_date" => [{start_min, end_min}] }
            const bookedVenues = {};
            // teamMatches: { "teamId_date" => [{start_min, end_min}] }
            const teamMatches  = {};

            const existing = await query(
                `SELECT match_date, match_start_time, match_end_time, venue_id, team1_id, team2_id
                 FROM fixtures WHERE tournament_id = ? AND match_date IS NOT NULL AND is_bye = 0`,
                [tournament_id]
            );
            for (const match of existing) {
                const date = formatDate(match.match_date);
                const dayStart = Date.parse(`${date}T00:00:00.000Z`) / 60000;
                const clockStart = timeToMinutes(match.match_start_time);
                const clockEnd = timeToMinutes(match.match_end_time);
                const start_min = dayStart + clockStart;
                const end_min = dayStart + clockEnd;
                if (match.venue_id) (bookedVenues[`${match.venue_id}_${date}`] ||= []).push({ start_min: clockStart, end_min: clockEnd });
                for (const teamId of [match.team1_id, match.team2_id].filter(Boolean)) {
                    (teamMatches[teamId] ||= []).push({ start_min, end_min });
                }
            }

            const dates       = dateRange(formatDate(new Date(t.start_date)), formatDate(new Date(t.end_date)));
            const scheduled   = [];
            const unscheduled = [];
            const warnings    = [];

            /**
             * Check if two intervals [s1,e1) and [s2,e2) overlap.
             */
            function overlaps(s1, e1, s2, e2) {
                return s1 < e2 && s2 < e1;
            }

            /**
             * Check if a team is free on a date for [slotStart, slotEnd).
             * Uses the tournament time window and already-scheduled matches
             * (rest time between consecutive matches on same day).
             */
            function teamIsFree(teamId, date, slotStart, slotEnd) {
                // Check existing matches for overlap / rest time
                const dayStart = Date.parse(`${date}T00:00:00.000Z`) / 60000;
                const absoluteStart = dayStart + slotStart;
                const absoluteEnd = dayStart + slotEnd;
                const matches = teamMatches[teamId] || [];
                for (const m of matches) {
                    // Direct overlap
                    if (overlaps(absoluteStart, absoluteEnd, m.start_min, m.end_min)) return false;
                    // Rest time also applies across consecutive tournament dates.
                    const gap = Math.max(absoluteStart - m.end_min, m.start_min - absoluteEnd);
                    if (gap < restMins) return false;
                }

                return true;
            }

            /**
             * Find an available venue on a date for [slotStart, slotEnd).
             * Returns venue object or null.
             */
            function findVenue(date, slotStart, slotEnd) {
                // Collect unique venue ids that have a slot covering [slotStart, slotEnd)
                const coveredVenues = new Map();
                for (const [key, slots] of Object.entries(venueSlots)) {
                    const keyDate = key.split('_').slice(1).join('_'); // handles venue_id that could have _
                    // extract date portion: everything after first underscore segment (venue id is int)
                    const underscoreIdx = key.indexOf('_');
                    const kDate         = key.substring(underscoreIdx + 1);
                    if (kDate !== date) continue;
                    for (const slot of slots) {
                        if (slot.start_min <= slotStart && slot.end_min >= slotEnd) {
                            coveredVenues.set(slot.venue_id, slot.venue_name);
                        }
                    }
                }

                // Pick a venue that is not already booked
                for (const [venueId, venueName] of coveredVenues) {
                    const bKey   = `${venueId}_${date}`;
                    const booked = bookedVenues[bKey] || [];
                    const conflict = booked.some(b => overlaps(slotStart, slotEnd, b.start_min, b.end_min));
                    if (!conflict) return { venue_id: venueId, venue_name: venueName };
                }

                return null;
            }

            // 6. Main scheduling loop
            for (const fixture of fixtures) {
                let assigned = false;

                for (const date of dates) {
                    // Try candidate start times in steps of match_duration_minutes
                    // from tourneyStart up to (tourneyEnd - durationMins)
                    for (
                        let slotStart = tourneyStart;
                        slotStart + durationMins <= tourneyEnd;
                        slotStart += durationMins
                    ) {
                        const slotEnd = slotStart + durationMins;

                        // Check both teams' availability
                        if (!teamIsFree(fixture.team1_id, date, slotStart, slotEnd)) continue;
                        if (!teamIsFree(fixture.team2_id, date, slotStart, slotEnd)) continue;

                        // Find an available venue
                        const venue = findVenue(date, slotStart, slotEnd);
                        if (!venue) continue;

                        // All checks passed — assign this slot
                        const startTimeStr = addMinutes(t.match_start_time, slotStart - tourneyStart);
                        const endTimeStr   = addMinutes(t.match_start_time, slotEnd   - tourneyStart);

                        await query(
                            `UPDATE fixtures
                             SET match_date = ?, match_start_time = ?,
                                 match_end_time = ?, venue_id = ?, status = 'SCHEDULED'
                             WHERE id = ?`,
                            [date, startTimeStr, endTimeStr, venue.venue_id, fixture.id]
                        );

                        // Update in-memory bookings
                        const vKey = `${venue.venue_id}_${date}`;
                        if (!bookedVenues[vKey]) bookedVenues[vKey] = [];
                        bookedVenues[vKey].push({ start_min: slotStart, end_min: slotEnd });

                        const dayStart = Date.parse(`${date}T00:00:00.000Z`) / 60000;
                        const bookedMatch = { start_min: dayStart + slotStart, end_min: dayStart + slotEnd };
                        (teamMatches[fixture.team1_id] ||= []).push(bookedMatch);
                        (teamMatches[fixture.team2_id] ||= []).push(bookedMatch);

                        scheduled.push({
                            id             : fixture.id,
                            round          : fixture.round,
                            team1_name     : fixture.team1_name,
                            team2_name     : fixture.team2_name,
                            match_date     : date,
                            match_start_time: startTimeStr,
                            match_end_time : endTimeStr,
                            venue_name     : venue.venue_name
                        });

                        assigned = true;
                        break;
                    }
                    if (assigned) break;
                }

                if (!assigned) {
                    unscheduled.push({
                        id        : fixture.id,
                        round     : fixture.round,
                        team1_name: fixture.team1_name,
                        team2_name: fixture.team2_name,
                        reason    : 'No available slot found across all tournament dates'
                    });
                    warnings.push(
                        `Fixture ${fixture.id} (${fixture.team1_name} vs ${fixture.team2_name}) ` +
                        `could not be scheduled — check team/venue availability and tournament date range.`
                    );
                }
            }

            return res.status(200).json({
                message: 'Auto-scheduling complete',
                scheduled,
                unscheduled,
                data   : {
                    scheduled,
                    unscheduled,
                    warnings,
                    summary: {
                        total      : fixtures.length,
                        scheduled  : scheduled.length,
                        unscheduled: unscheduled.length
                    }
                }
            });

        } catch (err) {
            console.error('Schedule fixtures error:', err);
            return res.status(500).json({ message: 'Failed to schedule fixtures' });
        }
    }
);

// =============================================================================
// GET /api/fixtures?tournament_id=X
// Retrieve all fixtures for a tournament with team and venue names.
// =============================================================================
router.get(
    '/my',
    verifyToken,
    authorizeRole('TEAM_CAPTAIN_PLAYER', 'PLAYER'),
    (req, res) => {
        const selectedTeamId = req.query.team_id;
        const playerSelectedTeam = req.user.role === 'PLAYER' && selectedTeamId;
        const matchFilter = playerSelectedTeam
            ? '(f.team1_id = ? OR f.team2_id = ?)'
            : `t1.captain_id = ? OR t2.captain_id = ?
               OR EXISTS (
                    SELECT 1 FROM player_team_memberships membership
                    WHERE membership.user_id = ?
                      AND membership.team_id IN (f.team1_id, f.team2_id)
               )`;
        const sql = `
            SELECT f.id, f.tournament_id, t.name AS tournament_name, t.sport, t.format,
                   f.round, f.team1_id, t1.team_name AS team1_name,
                   t1.group_name AS team1_group, f.team2_id, t2.team_name AS team2_name,
                   t2.group_name AS team2_group,
                   f.match_date, f.match_start_time, f.match_end_time,
                   f.venue_id, v.venue_name, f.is_bye, f.status
            FROM fixtures f
            JOIN tournaments t ON t.id = f.tournament_id
            JOIN teams t1 ON t1.id = f.team1_id
            LEFT JOIN teams t2 ON t2.id = f.team2_id
            LEFT JOIN venues v ON v.id = f.venue_id
            WHERE ${matchFilter}
            ORDER BY t.start_date, f.round, f.match_date, f.match_start_time, f.id`;
        const params = playerSelectedTeam
            ? [selectedTeamId, selectedTeamId]
            : [req.user.id, req.user.id, req.user.id];
        db.query(sql, params, (err, matches) => {
            if (err) {
                console.error('Captain matches error:', err);
                return res.status(500).json({ message: 'Failed to retrieve your team matches' });
            }
            return res.status(200).json({ matches });
        });
    }
);

router.get(
    '/',
    verifyToken,
    authorizeRole('ORGANIZER', 'ADMIN'),
    (req, res) => {
        const { tournament_id } = req.query;

        if (!tournament_id) {
            return res.status(400).json({ message: 'tournament_id query param is required' });
        }

        const sql = `
            SELECT
                f.id,
                f.tournament_id,
                f.round,
                f.team1_id,
                t1.team_name    AS team1_name,
                t1.group_name   AS team1_group,
                f.team2_id,
                t2.team_name    AS team2_name,
                t2.group_name   AS team2_group,
                f.match_date,
                f.match_start_time,
                f.match_end_time,
                f.venue_id,
                v.venue_name,
                f.is_bye,
                f.status,
                f.created_at
            FROM fixtures f
            JOIN  teams t1  ON f.team1_id = t1.id
            LEFT JOIN teams t2  ON f.team2_id  = t2.id
            LEFT JOIN venues v  ON f.venue_id   = v.id
            WHERE f.tournament_id = ?
              AND (? = 'ADMIN' OR EXISTS (
                  SELECT 1 FROM tournaments t
                  WHERE t.id = f.tournament_id AND t.organizer_id = ?
              ))
            ORDER BY f.round, f.match_date, f.match_start_time, f.id
        `;

        db.query(sql, [tournament_id, req.user.role, req.user.id], (err, results) => {
            if (err) {
                console.error('Get fixtures error:', err);
                return res.status(500).json({ message: 'Failed to retrieve fixtures' });
            }

            return res.status(200).json({
                message: 'Fixtures retrieved successfully',
                data   : results,
                fixtures: results
            });
        });
    }
);

// =============================================================================
// GET /api/fixtures/plan?tournament_id=X
// Complete tournament plan grouped by round, plus tournament info & conflicts.
// =============================================================================
router.get(
    '/plan',
    verifyToken,
    authorizeRole('ORGANIZER', 'ADMIN'),
    async (req, res) => {
        const { tournament_id } = req.query;

        if (!tournament_id) {
            return res.status(400).json({ message: 'tournament_id query param is required' });
        }

        try {
            // Tournament info
            const tRows = await query(
                `SELECT id, name, sport, format, start_date, end_date, organizer_id,
                        match_start_time, match_end_time,
                        match_duration_minutes, minimum_rest_minutes
                 FROM tournaments WHERE id = ?`,
                [tournament_id]
            );

            if (tRows.length === 0) {
                return res.status(404).json({ message: 'Tournament not found' });
            }
            if (req.user.role === 'ORGANIZER' && Number(tRows[0].organizer_id) !== Number(req.user.id)) {
                return res.status(403).json({ message: 'Access denied' });
            }

            // All fixtures with names
            const fixtures = await query(
                `SELECT
                    f.id, f.round, f.is_bye, f.status,
                    f.team1_id, t1.team_name AS team1_name, t1.group_name AS team1_group,
                    f.team2_id, t2.team_name AS team2_name, t2.group_name AS team2_group,
                    f.match_date, f.match_start_time, f.match_end_time,
                    f.venue_id, v.venue_name
                 FROM fixtures f
                 JOIN  teams t1 ON f.team1_id = t1.id
                 LEFT JOIN teams t2 ON f.team2_id  = t2.id
                 LEFT JOIN venues v ON f.venue_id   = v.id
                 WHERE f.tournament_id = ?
                 ORDER BY f.round, f.match_date, f.match_start_time, f.id`,
                [tournament_id]
            );

            // Group by round
            const rounds = {};
            for (const fx of fixtures) {
                if (!rounds[fx.round]) rounds[fx.round] = [];
                rounds[fx.round].push(fx);
            }

            // Conflict summary: unscheduled (non-bye) fixtures
            const unscheduled = fixtures.filter(fx => !fx.match_date && !fx.is_bye);

            return res.status(200).json({
                message: 'Tournament plan retrieved successfully',
                plan   : { ...tRows[0], fixtures, rounds },
                data   : {
                    tournament     : tRows[0],
                    rounds,
                    total_fixtures : fixtures.length,
                    scheduled_count: fixtures.filter(fx => fx.match_date).length,
                    conflict_count : unscheduled.length,
                    unscheduled_fixtures: unscheduled
                }
            });

        } catch (err) {
            console.error('Tournament plan error:', err);
            return res.status(500).json({ message: 'Failed to retrieve tournament plan' });
        }
    }
);

// =============================================================================
// GET /api/fixtures/conflicts?tournament_id=X
// Conflict report: venue double bookings, team overlaps, rest-time violations.
// =============================================================================
router.get(
    '/conflicts',
    verifyToken,
    authorizeRole('ORGANIZER', 'ADMIN'),
    async (req, res) => {
        const { tournament_id } = req.query;

        if (!tournament_id) {
            return res.status(400).json({ message: 'tournament_id query param is required' });
        }

        try {
            // Tournament (need minimum_rest_minutes)
            const tRows = await query(
                `SELECT id, name, minimum_rest_minutes, organizer_id
                 FROM tournaments WHERE id = ?`,
                [tournament_id]
            );

            if (tRows.length === 0) {
                return res.status(404).json({ message: 'Tournament not found' });
            }

            const t = tRows[0];

            if (req.user.role === 'ORGANIZER' && Number(t.organizer_id) !== Number(req.user.id)) {
                return res.status(403).json({ message: 'Access denied' });
            }

            const restMins = Number(t.minimum_rest_minutes) || 0;
            const selectedVenueRows = await query(
                'SELECT venue_id FROM tournament_venues WHERE tournament_id = ?',
                [tournament_id]
            );
            const selectedVenueIds = selectedVenueRows.map(row => Number(row.venue_id));

            // Fetch scheduled fixtures only (match_date NOT NULL, not BYE)
            const fixtures = await query(
                `SELECT
                    f.id, f.round,
                    f.team1_id, t1.team_name AS team1_name,
                    f.team2_id, t2.team_name AS team2_name,
                    f.match_date, f.match_start_time, f.match_end_time,
                    f.venue_id, v.venue_name
                 FROM fixtures f
                 JOIN  teams t1 ON f.team1_id = t1.id
                 LEFT JOIN teams t2 ON f.team2_id  = t2.id
                 LEFT JOIN venues v ON f.venue_id   = v.id
                 WHERE f.tournament_id = ?
                   AND f.match_date IS NOT NULL
                   AND f.is_bye = 0
                 ORDER BY f.match_date, f.match_start_time`,
                [tournament_id]
            );

            const unscheduledFixtures = await query(
                `SELECT f.id, f.round, t1.team_name AS team1_name, t2.team_name AS team2_name
                 FROM fixtures f JOIN teams t1 ON t1.id = f.team1_id
                 LEFT JOIN teams t2 ON t2.id = f.team2_id
                 WHERE f.tournament_id = ? AND f.match_date IS NULL AND f.is_bye = 0`,
                [tournament_id]
            );

            const conflicts = [];
            for (const fx of unscheduledFixtures) {
                conflicts.push({
                    type: 'NO_VALID_SLOT', fixture_a: fx.id,
                    detail: `No valid date, time, or venue slot was found for ${fx.team1_name} vs ${fx.team2_name} (round ${fx.round}).`
                });
            }

            function overlapsFx(a, b) {
                return timeToMinutes(a.match_start_time) < timeToMinutes(b.match_end_time) &&
                       timeToMinutes(b.match_start_time) < timeToMinutes(a.match_end_time);
            }

            function sameDate(a, b) {
                return formatDate(a.match_date) === formatDate(b.match_date);
            }

            const venueWindows = await query(
                `SELECT va.venue_id, va.available_date, va.start_time, va.end_time, v.venue_name
                 FROM venue_availability va JOIN venues v ON v.id = va.venue_id
                 WHERE va.is_available = 1 AND v.venue_type =
                   (SELECT sport FROM tournaments WHERE id = ?)`, [tournament_id]
            );

            for (const fx of fixtures) {
                const date = formatDate(fx.match_date);
                const start = timeToMinutes(fx.match_start_time);
                const end = timeToMinutes(fx.match_end_time);
                if (selectedVenueIds.length && !selectedVenueIds.includes(Number(fx.venue_id))) {
                    conflicts.push({ type: 'VENUE_NOT_SELECTED', venue_name: fx.venue_name, fixture_a: fx.id,
                        detail: `Venue "${fx.venue_name || fx.venue_id || 'Unknown'}" was not selected for this tournament.` });
                }
                if (!venueWindows.some(w => w.venue_id === fx.venue_id && formatDate(w.available_date) === date &&
                    timeToMinutes(w.start_time) <= start && timeToMinutes(w.end_time) >= end)) {
                    conflicts.push({ type: 'VENUE_UNAVAILABLE', venue_name: fx.venue_name, fixture_a: fx.id,
                        detail: `Venue "${fx.venue_name || fx.venue_id || 'Unknown'}" is unavailable for fixture ${fx.id} on ${date}.` });
                }
            }

            // Check all pairs
            for (let i = 0; i < fixtures.length; i++) {
                for (let j = i + 1; j < fixtures.length; j++) {
                    const a = fixtures[i];
                    const b = fixtures[j];

                    const isSameDate = sameDate(a, b);

                    // 1. Venue double-booking
                    if (isSameDate && a.venue_id && b.venue_id && a.venue_id === b.venue_id) {
                        if (overlapsFx(a, b)) {
                            conflicts.push({
                                type       : 'VENUE_DOUBLE_BOOKING',
                                venue_name : a.venue_name,
                                fixture_a  : a.id,
                                fixture_b  : b.id,
                                detail     : `Venue "${a.venue_name}" double-booked on ${formatDate(a.match_date)}: ` +
                                             `Fixture ${a.id} (${a.match_start_time}–${a.match_end_time}) vs ` +
                                             `Fixture ${b.id} (${b.match_start_time}–${b.match_end_time})`
                            });
                        }
                    }

                    // 2. Team overlap (a team appears in both fixtures)
                    const teamsA = [a.team1_id, a.team2_id].filter(Boolean);
                    const teamsB = [b.team1_id, b.team2_id].filter(Boolean);
                    const sharedTeams = teamsA.filter(id => teamsB.includes(id));

                    for (const tid of sharedTeams) {
                        const teamName = [a, b]
                            .flatMap(fx => [
                                { id: fx.team1_id, name: fx.team1_name },
                                { id: fx.team2_id, name: fx.team2_name }
                            ])
                            .find(x => x.id === tid)?.name;

                        // Direct overlap
                        if (isSameDate && overlapsFx(a, b)) {
                            conflicts.push({
                                type      : 'TEAM_OVERLAP',
                                team_name : teamName,
                                fixture_a : a.id,
                                fixture_b : b.id,
                                detail    : `Team "${teamName}" has overlapping matches on ${formatDate(a.match_date)}: ` +
                                            `Fixture ${a.id} (${a.match_start_time}–${a.match_end_time}) and ` +
                                            `Fixture ${b.id} (${b.match_start_time}–${b.match_end_time})`
                            });
                        }

                        // 3. Rest-time violation
                        if (restMins > 0) {
                            const aDay = Date.parse(`${formatDate(a.match_date)}T00:00:00.000Z`) / 60000;
                            const bDay = Date.parse(`${formatDate(b.match_date)}T00:00:00.000Z`) / 60000;
                            const aStart = aDay + timeToMinutes(a.match_start_time);
                            const aEnd = aDay + timeToMinutes(a.match_end_time);
                            const bStart = bDay + timeToMinutes(b.match_start_time);
                            const bEnd = bDay + timeToMinutes(b.match_end_time);
                            const gap = aStart < bStart ? bStart - aEnd : aStart - bEnd;

                            if (gap >= 0 && gap < restMins) {
                                conflicts.push({
                                    type      : 'REST_TIME_VIOLATION',
                                    team_name : teamName,
                                    fixture_a : a.id,
                                    fixture_b : b.id,
                                    gap_minutes : gap,
                                    required_rest: restMins,
                                    detail    : `Team "${teamName}" has only ${gap} min rest between ` +
                                                `Fixture ${a.id} and Fixture ${b.id} ` +
                                                `(minimum required: ${restMins} min)`
                                });
                            }
                        }
                    }
                }
            }

            return res.status(200).json({
                message       : 'Conflict report generated',
                conflicts,
                data          : {
                    total_conflicts        : conflicts.length,
                    venue_double_bookings  : conflicts.filter(c => c.type === 'VENUE_DOUBLE_BOOKING').length,
                    venue_availability_violations: conflicts.filter(c => c.type === 'VENUE_UNAVAILABLE').length,
                    team_overlaps          : conflicts.filter(c => c.type === 'TEAM_OVERLAP').length,
                    rest_time_violations   : conflicts.filter(c => c.type === 'REST_TIME_VIOLATION').length,
                    impossible_schedules   : conflicts.filter(c => c.type === 'NO_VALID_SLOT').length,
                    conflicts
                }
            });

        } catch (err) {
            console.error('Conflicts error:', err);
            return res.status(500).json({ message: 'Failed to generate conflict report' });
        }
    }
);

module.exports = router;
