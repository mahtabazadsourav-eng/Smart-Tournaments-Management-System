const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../config/db');

// Verify JWT Token
const verifyToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({
            message: 'Access denied. Token required.'
        });
    }

    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
        if (err) {
            return res.status(403).json({
                message: 'Invalid or expired token'
            });
        }

        const tokenHash = crypto
            .createHash('sha256')
            .update(token)
            .digest('hex');

        const sql = `
            SELECT id FROM revoked_tokens
            WHERE token_hash = ?
        `;

        db.query(sql, [tokenHash], (dbErr, results) => {
            if (dbErr) {
                console.error('Token check error:', dbErr);

                return res.status(500).json({
                    message: 'Authentication error'
                });
            }

            if (results.length > 0) {
                return res.status(401).json({
                    message: 'Token has been logged out'
                });
            }

            req.user = decoded;
            next();
        });
    });
};

// Check User Role
const authorizeRole = (...allowedRoles) => {
    return (req, res, next) => {
        if (!allowedRoles.includes(req.user.role)) {
            return res.status(403).json({
                message: 'Access denied. Insufficient permission.'
            });
        }

        next();
    };
};

module.exports = {
    verifyToken,
    authorizeRole
};