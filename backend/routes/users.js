const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const db = require('../config/db');
const { verifyToken, authorizeRole } = require('../middleware/auth');
const router = express.Router();

// User Registration API
router.post('/register', async (req, res) => {
    let connection;
    try {
        const { name, email, password, role } = req.body;

        // Check required fields
        if (!name || !email || !password) {
            return res.status(400).json({
                message: 'Name, email and password are required'
            });
        }

        // Validate role
        const allowedRoles = ['ORGANIZER', 'VENUE_COORDINATOR', 'PLAYER', 'TEAM_CAPTAIN_PLAYER'];
        let userRole = role || 'TEAM_CAPTAIN_PLAYER';

        if (!allowedRoles.includes(userRole)) {
            return res.status(400).json({
                message: 'Invalid user role'
            });
        }
        const normalizedEmail = String(email).trim().toLowerCase();
        const hashedPassword = await bcrypt.hash(password, 10);
        connection = await db.promise().getConnection();
        await connection.beginTransaction();

        let rosterPlayers = [];
        if (userRole === 'TEAM_CAPTAIN_PLAYER' && role !== 'PLAYER') {
            const [rows] = await connection.query(
                `SELECT tp.id, tp.team_id, tp.team_role, tp.email, tp.player_name, teams.captain_id
                 FROM team_players tp JOIN teams ON teams.id = tp.team_id
                 WHERE LOWER(tp.email) = ? AND tp.user_id IS NULL
                 ORDER BY tp.id FOR UPDATE`,
                [normalizedEmail]
            );
            rosterPlayers = rows;
            if (rosterPlayers.some(player => player.team_role === 'CAPTAIN' && player.captain_id)) {
                await connection.rollback();
                return res.status(409).json({ message: 'A captain account is already linked to this team' });
            }
        }

        const [result] = await connection.query(
            `INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)`,
            [name.trim(), normalizedEmail, hashedPassword, userRole]
        );

        for (const player of rosterPlayers) {
            await connection.query(
                `UPDATE team_players SET user_id = ?, player_name = ? WHERE id = ? AND user_id IS NULL`,
                [result.insertId, name.trim(), player.id]
            );
            if (player.team_role === 'CAPTAIN') {
                await connection.query(
                    `UPDATE teams SET captain_id = ? WHERE id = ? AND captain_id IS NULL`,
                    [result.insertId, player.team_id]
                );
            }
        }

        await connection.commit();
        return res.status(201).json({
            message: 'User registered successfully',
            linkedRosterEntries: rosterPlayers.length
        });

    } catch (error) {
        if (connection) {
            try { await connection.rollback(); } catch (_) { /* transaction may already be closed */ }
        }
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ message: 'Email already registered' });
        }
        console.error('Registration error:', error.message);
        return res.status(500).json({ message: 'Server error during registration' });
    } finally {
        if (connection) connection.release();
    }
});

// Admin user management: list accounts and update roles. Password hashes are never returned.
router.get('/admin/list', verifyToken, authorizeRole('ADMIN'), async (req, res) => {
    try {
        const [users] = await db.promise().query(
            `SELECT id, name, email, role, created_at
             FROM users ORDER BY created_at DESC, id DESC`
        );
        return res.json({ users, total: users.length });
    } catch (error) {
        console.error('Admin user list error:', error.message);
        return res.status(500).json({ message: 'Failed to load user accounts' });
    }
});

router.put('/admin/:id/role', verifyToken, authorizeRole('ADMIN'), async (req, res) => {
    const targetId = Number(req.params.id);
    const newRole = String(req.body.role || '').toUpperCase();
    const allowedRoles = ['ADMIN', 'ORGANIZER', 'VENUE_COORDINATOR', 'TEAM_CAPTAIN_PLAYER', 'PLAYER'];
    if (!Number.isInteger(targetId) || targetId <= 0 || !allowedRoles.includes(newRole)) {
        return res.status(400).json({ message: 'A valid user ID and role are required' });
    }
    if (targetId === Number(req.user.id) && newRole !== 'ADMIN') {
        return res.status(409).json({ message: 'You cannot remove your own ADMIN role' });
    }
    try {
        const [targetRows] = await db.promise().query('SELECT id, role FROM users WHERE id = ?', [targetId]);
        if (!targetRows.length) return res.status(404).json({ message: 'User account not found' });
        if (targetRows[0].role === 'ADMIN' && newRole !== 'ADMIN') {
            const [adminRows] = await db.promise().query("SELECT COUNT(*) AS total FROM users WHERE role = 'ADMIN'");
            if (Number(adminRows[0].total) <= 1) {
                return res.status(409).json({ message: 'The last ADMIN account cannot be demoted' });
            }
        }
        await db.promise().query('UPDATE users SET role = ? WHERE id = ?', [newRole, targetId]);
        return res.json({ message: 'User role updated successfully', user_id: targetId, role: newRole });
    } catch (error) {
        console.error('Admin role update error:', error.message);
        return res.status(500).json({ message: 'Failed to update user role' });
    }
});

// Restore the current account after a frontend page reload.
router.get('/me', verifyToken, (req, res) => {
    db.query(
        'SELECT id, name, email, role FROM users WHERE id = ? LIMIT 1',
        [req.user.id],
        (err, results) => {
            if (err) {
                console.error('Current user lookup error:', err.message);
                return res.status(500).json({ message: 'Failed to load account' });
            }
            if (!results.length) return res.status(404).json({ message: 'Account not found' });
            return res.status(200).json({ user: results[0] });
        }
    );
});

// User Login API
router.post('/login', (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({
            message: 'Email and password are required'
        });
    }

    const sql = 'SELECT * FROM users WHERE email = ?';

    db.query(sql, [String(email).trim().toLowerCase()], async (err, results) => {
        if (err) {
            console.error('Login DB error:', err);
            return res.status(500).json({
                message: 'Database error'
            });
        }

        if (results.length === 0) {
            return res.status(401).json({
                message: 'Invalid email or password'
            });
        }

        const user = results[0];

        const isMatch = await bcrypt.compare(
            password,
            user.password_hash
        );

        if (!isMatch) {
            return res.status(401).json({
                message: 'Invalid email or password'
            });
        }

        const token = jwt.sign(
            {
                id: user.id,
                role: user.role
            },
            process.env.JWT_SECRET,
            { expiresIn: '1d' }
        );

        res.status(200).json({
            message: 'Login successful',
            token: token,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                role: user.role
            }
        });
    });
});
// User Logout API
router.post('/logout', verifyToken, (req, res) => {

    const authHeader = req.headers['authorization'];
    const token = authHeader.split(' ')[1];

    const tokenHash = crypto
        .createHash('sha256')
        .update(token)
        .digest('hex');

    const expiresAt = new Date(req.user.exp * 1000);

    const sql = `
        INSERT INTO revoked_tokens (token_hash, expires_at)
        VALUES (?, ?)
    `;

    db.query(sql, [tokenHash, expiresAt], (err) => {

        if (err) {
            console.error('Logout error:', err);

            return res.status(500).json({
                message: 'Logout failed'
            });
        }

        res.status(200).json({
            message: 'Logout successful'
        });
    });
});

module.exports = router;
