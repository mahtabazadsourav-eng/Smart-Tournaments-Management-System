/** Sprint 4 - Alternative fixture scheduling suggestions and safe application. */
'use strict';

const express = require('express');
const db = require('../config/db');
const { verifyToken, authorizeRole } = require('../middleware/auth');
const router = express.Router();

function validId(value) { return Number.isInteger(Number(value)) && Number(value) > 0; }
function minutes(value) {
    if (!value) return null;
    const parts = String(value).split(':').map(Number);
    return (parts[0] * 60) + parts[1];
}
function timeText(total) {
    const h = Math.floor(total / 60);
    const m = total % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
}
function dateText(value) {
    if (typeof value === 'string') return value.slice(0, 10);
    return new Date(value).toISOString().slice(0, 10);
}
function absoluteMinute(date, time) {
    return (Date.parse(`${dateText(date)}T00:00:00Z`) / 60000) + minutes(time);
}
function overlaps(aStart, aEnd, bStart, bEnd) { return aStart < bEnd && bStart < aEnd; }

async function loadFixture(user, fixtureId) {
    const [rows] = await db.promise().query(
        `SELECT f.id, f.tournament_id, f.team1_id, f.team2_id, f.status, f.is_bye,
                t.organizer_id, t.sport, t.start_date, t.end_date,
                t.match_start_time, t.match_end_time, t.match_duration_minutes,
                t.minimum_rest_minutes, t1.team_name AS team1_name, t2.team_name AS team2_name
         FROM fixtures f JOIN tournaments t ON t.id = f.tournament_id
         JOIN teams t1 ON t1.id = f.team1_id LEFT JOIN teams t2 ON t2.id = f.team2_id
         WHERE f.id = ?`, [fixtureId]
    );
    if (!rows.length) return { error: 'Fixture not found', status: 404 };
    const fixture = rows[0];
    if (user.role !== 'ADMIN' && Number(fixture.organizer_id) !== Number(user.id)) {
        return { error: 'Access denied', status: 403 };
    }
    if (fixture.status === 'COMPLETED' || fixture.status === 'CANCELLED' || Number(fixture.is_bye) === 1 || !fixture.team2_id) {
        return { error: 'Only pending, non-BYE fixtures can be rescheduled', status: 409 };
    }
    if (!fixture.match_start_time || !fixture.match_end_time || !fixture.match_duration_minutes) {
        return { error: 'Set tournament match times and duration before requesting alternatives', status: 400 };
    }
    return { fixture };
}

async function getCandidateSlots(fixture) {
    const duration = Number(fixture.match_duration_minutes);
    const windowStart = minutes(fixture.match_start_time);
    const windowEnd = minutes(fixture.match_end_time);
    const rest = Number(fixture.minimum_rest_minutes || 0);
    if (!Number.isInteger(duration) || duration <= 0 || windowStart === null || windowEnd <= windowStart) {
        return { error: 'Tournament scheduling configuration is invalid', status: 400 };
    }

    const [availability] = await db.promise().query(
        `SELECT va.id AS availability_id, va.venue_id, va.available_date,
                va.start_time, va.end_time, va.is_available, v.venue_name
         FROM tournament_venues tv
         JOIN venue_availability va ON va.id = tv.availability_id
         JOIN venues v ON v.id = tv.venue_id AND v.id = va.venue_id
         WHERE tv.tournament_id = ? AND v.venue_type = ?
           AND (va.is_available = 1 OR va.is_available IS NULL)
           AND va.available_date BETWEEN ? AND ?
         ORDER BY va.available_date, va.start_time`,
        [fixture.tournament_id, fixture.sport, dateText(fixture.start_date), dateText(fixture.end_date)]
    );
    if (!availability.length) return { error: 'No selected venue availability exists inside the tournament date range', status: 400 };

    const [existing] = await db.promise().query(
        `SELECT id, team1_id, team2_id, venue_id, match_date, match_start_time, match_end_time
         FROM fixtures WHERE tournament_id = ? AND id <> ?
           AND match_date IS NOT NULL AND status <> 'CANCELLED' AND is_bye = 0`,
        [fixture.tournament_id, fixture.id]
    );
    const candidates = [];
    for (const slot of availability) {
        const date = dateText(slot.available_date);
        const availableStart = Math.max(minutes(slot.start_time), windowStart);
        const availableEnd = Math.min(minutes(slot.end_time), windowEnd);
        for (let start = availableStart; start + duration <= availableEnd; start += duration) {
            const end = start + duration;
            const absoluteStart = absoluteMinute(date, timeText(start));
            const absoluteEnd = absoluteMinute(date, timeText(end));
            let blocked = false;
            for (const booked of existing) {
                const bookedDate = dateText(booked.match_date);
                const bookedStart = absoluteMinute(bookedDate, booked.match_start_time);
                const bookedEnd = absoluteMinute(bookedDate, booked.match_end_time);
                if (Number(booked.venue_id) === Number(slot.venue_id) && bookedDate === date && overlaps(start, end, minutes(booked.match_start_time), minutes(booked.match_end_time))) {
                    blocked = true; break;
                }
                const sharedTeam = [fixture.team1_id, fixture.team2_id].some(id =>
                    Number(id) === Number(booked.team1_id) || Number(id) === Number(booked.team2_id));
                if (sharedTeam) {
                    const gap = Math.max(absoluteStart - bookedEnd, bookedStart - absoluteEnd);
                    if (gap < rest) { blocked = true; break; }
                }
            }
            if (!blocked) candidates.push({
                availability_id: Number(slot.availability_id), venue_id: Number(slot.venue_id),
                venue_name: slot.venue_name, match_date: date,
                match_start_time: timeText(start), match_end_time: timeText(end)
            });
            if (candidates.length >= 40) return { candidates };
        }
    }
    return { candidates };
}

// POST /api/alternative-schedule/options { fixture_id }
router.post('/options', verifyToken, authorizeRole('ORGANIZER', 'ADMIN'), async (req, res) => {
    if (!validId(req.body.fixture_id)) return res.status(400).json({ message: 'A valid fixture_id is required' });
    try {
        const loaded = await loadFixture(req.user, Number(req.body.fixture_id));
        if (loaded.error) return res.status(loaded.status).json({ message: loaded.error });
        const result = await getCandidateSlots(loaded.fixture);
        if (result.error) return res.status(result.status).json({ message: result.error });
        return res.json({ fixture_id: loaded.fixture.id, alternatives: result.candidates, total: result.candidates.length });
    } catch (err) {
        console.error('Alternative schedule options error:', err);
        return res.status(500).json({ message: 'Failed to generate alternative schedule options' });
    }
});

// POST /api/alternative-schedule/apply { fixture_id, venue_id, match_date, match_start_time }
router.post('/apply', verifyToken, authorizeRole('ORGANIZER', 'ADMIN'), async (req, res) => {
    const { fixture_id, venue_id, match_date, match_start_time } = req.body;
    if (!validId(fixture_id) || !validId(venue_id) || !/^\d{4}-\d{2}-\d{2}$/.test(String(match_date || '')) || !/^\d{2}:\d{2}(:\d{2})?$/.test(String(match_start_time || ''))) {
        return res.status(400).json({ message: 'fixture_id, venue_id, match_date and valid match_start_time are required' });
    }
    try {
        const loaded = await loadFixture(req.user, Number(fixture_id));
        if (loaded.error) return res.status(loaded.status).json({ message: loaded.error });
        const fixture = loaded.fixture;
        const start = minutes(match_start_time);
        const duration = Number(fixture.match_duration_minutes);
        const end = start + duration;
        const windowStart = minutes(fixture.match_start_time);
        const windowEnd = minutes(fixture.match_end_time);
        if (match_date < dateText(fixture.start_date) || match_date > dateText(fixture.end_date) || start < windowStart || end > windowEnd) {
            return res.status(422).json({ message: 'The selected alternative is outside the tournament scheduling window' });
        }

        const [slots] = await db.promise().query(
            `SELECT va.id FROM tournament_venues tv
             JOIN venue_availability va ON va.id = tv.availability_id
             JOIN venues v ON v.id = tv.venue_id AND v.id = va.venue_id
             WHERE tv.tournament_id = ? AND tv.venue_id = ? AND v.venue_type = ?
               AND va.available_date = ? AND (va.is_available = 1 OR va.is_available IS NULL)
               AND va.start_time <= ? AND va.end_time >= ?`,
            [fixture.tournament_id, Number(venue_id), fixture.sport, match_date, timeText(start), timeText(end)]
        );
        if (!slots.length) return res.status(422).json({ message: 'The selected venue is not available for that date and time' });

        const [existing] = await db.promise().query(
            `SELECT id, team1_id, team2_id, venue_id, match_date, match_start_time, match_end_time
             FROM fixtures WHERE tournament_id = ? AND id <> ? AND match_date IS NOT NULL
               AND status <> 'CANCELLED' AND is_bye = 0`, [fixture.tournament_id, Number(fixture_id)]
        );
        const candidateStart = absoluteMinute(match_date, timeText(start));
        const candidateEnd = absoluteMinute(match_date, timeText(end));
        const rest = Number(fixture.minimum_rest_minutes || 0);
        for (const booked of existing) {
            const bookedDate = dateText(booked.match_date);
            const bs = minutes(booked.match_start_time), be = minutes(booked.match_end_time);
            if (Number(booked.venue_id) === Number(venue_id) && bookedDate === match_date && overlaps(start, end, bs, be)) {
                return res.status(409).json({ message: `Venue is already booked by fixture ${booked.id}` });
            }
            const sharesTeam = [fixture.team1_id, fixture.team2_id].some(id => Number(id) === Number(booked.team1_id) || Number(id) === Number(booked.team2_id));
            if (sharesTeam) {
                const gap = Math.max(candidateStart - absoluteMinute(bookedDate, booked.match_end_time), absoluteMinute(bookedDate, booked.match_start_time) - candidateEnd);
                if (gap < rest) return res.status(409).json({ message: `Team rest-time conflict with fixture ${booked.id}` });
            }
        }

        await db.promise().query(
            `UPDATE fixtures SET venue_id = ?, match_date = ?, match_start_time = ?,
                match_end_time = ?, status = 'SCHEDULED' WHERE id = ?`,
            [Number(venue_id), match_date, timeText(start), timeText(end), Number(fixture_id)]
        );
        return res.json({ message: 'Alternative schedule applied successfully', fixture_id: Number(fixture_id), venue_id: Number(venue_id), match_date, match_start_time: timeText(start), match_end_time: timeText(end) });
    } catch (err) {
        console.error('Apply alternative schedule error:', err);
        return res.status(500).json({ message: 'Failed to apply alternative schedule' });
    }
});

module.exports = router;
