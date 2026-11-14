require('./config/db');

const express = require('express');
const cors = require('cors');
const { verifyToken, authorizeRole } = require('./middleware/auth');

const app = express();

app.use(cors());
app.use(express.json());

// User routes
app.use('/api/users', require('./routes/users'));

app.get('/', (req, res) => {
    res.send('Smart Tournament Planner Backend is Running!');
});
// Tournament routes
app.use('/api/tournaments', require('./routes/tournaments'));
app.use('/api/teams', require('./routes/teams'));
app.use('/api/players', require('./routes/players'));
app.use('/api/venues', require('./routes/venues'));
app.use('/api/venue-availability', require('./routes/venueAvailability'));
app.use('/api/team-availability', require('./routes/teamAvailability'));
// Protected Captain Dashboard
app.get(
    '/api/captain/dashboard',
    verifyToken,
    authorizeRole('TEAM_CAPTAIN_PLAYER'),
    (req, res) => {
        res.json({
            message: 'Welcome to Captain Dashboard!',
            user: req.user
        });
    }
);

const PORT = 5000;

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});