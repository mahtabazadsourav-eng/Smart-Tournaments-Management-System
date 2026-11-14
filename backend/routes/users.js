const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const db = require('../config/db');
const { verifyToken } = require('../middleware/auth');
const router = express.Router();

// User Registration API
router.post('/register', async (req, res) => {
    try {
        const { name, email, password, role } = req.body;

        // Check required fields
        if (!name || !email || !password) {
            return res.status(400).json({
                message: 'Name, email and password are required'
            });
        }

        // Validate role
        const allowedRoles = [
            'ADMIN',
            'ORGANIZER',
            'VENUE_COORDINATOR',
            'TEAM_CAPTAIN_PLAYER'
        ];

        const userRole = role || 'TEAM_CAPTAIN_PLAYER';

        if (!allowedRoles.includes(userRole)) {
            return res.status(400).json({
                message: 'Invalid user role'
            });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Save user in MySQL
        const sql = `
            INSERT INTO users (name, email, password_hash, role)
            VALUES (?, ?, ?, ?)
        `;

        db.query(
            sql,
            [name, email, hashedPassword, userRole],
            (err, result) => {
                if (err) { console.error('Registration DB error:', err);
                    if (err.code === 'ER_DUP_ENTRY') {
                        return res.status(409).json({
                            message: 'Email already registered'
                        });
                    }

                    return res.status(500).json({
                        message: 'Database error'
                    });
                }

                res.status(201).json({
                    message: 'User registered successfully',
                    userId: result.insertId
                });
            }
        );

    } catch (error) {
        res.status(500).json({
            message: 'Server error'
        });
    }
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

    db.query(sql, [email], async (err, results) => {
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