# Smart Tournament Planner

## Project Overview
Full-stack web application for managing sports tournaments. Backend: Node.js/Express with MySQL. Frontend: Python Streamlit.

## Tech Stack
| Layer | Technology |
|-------|-----------|
| Backend | Node.js, Express.js |
| Frontend | Python, Streamlit |
| Database | MySQL |
| Auth | JWT (JSON Web Tokens) |

## Sprint Coverage
| Sprint | Features |
|--------|---------|
| Sprint 1 | User registration/login/logout, Role-based access, Tournament CRUD |
| Sprint 2 | Team & Player management, Venue management, Venue/Team availability, Schedule configuration |
| Sprint 3 | Fixture generation (Knockout & Round-Robin), Auto-scheduling, Conflict detection, Tournament plan view |

## User Roles
| Role | Access |
|------|--------|
| ORGANIZER | Tournaments, Teams, Fixtures, Scheduling |
| VENUE_COORDINATOR | Venues, Venue availability |
| PLAYER | Read own team details, roster and matches |
| TEAM_CAPTAIN_PLAYER | Team players, Team availability |
| ADMIN | Full access to everything |

## Setup Instructions

### Database Setup
1. Install MySQL and create the database:
```bash
mysql -u root -p < backend/schema_full.sql
```

### Backend Setup
```bash
cd backend
npm install
node server.js
# Backend runs on http://localhost:5000
```

On startup, the API updates the user role enum for player accounts and ensures
that the optional player email and player/captain/vice-captain role columns are
available in an existing `team_players` table.

### Player and captain accounts
1. An organizer adds roster players by name and assigns one role: Player,
   Captain, or Vice Captain.
2. A player signs up with the `PLAYER` role and selects a team. After login,
   they can see that team's details, roster, and fixtures. The roster role is
   shown independently from the player's login role.

The backend reads `backend/.env` from its own folder, including when you start it
from the project root. Set `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`,
`DB_PORT`, and a long random `JWT_SECRET` there. The API waits for MySQL and exits
with a clear error if the database is unavailable or configuration is incomplete.

### Frontend Setup
```bash
cd frontend
pip install streamlit requests
streamlit run app.py
# Frontend runs on http://localhost:8501
```

To use a different backend URL, set `API_BASE_URL` (including `/api`), for
example `http://127.0.0.1:5000/api`.

## API Endpoints Summary

### Authentication
- `POST /api/users/register` — Register new user
- `POST /api/users/login` — Login and get JWT token
- `POST /api/users/logout` — Logout (revokes token)

### Tournaments
- `GET/POST /api/tournaments` — List / Create
- `PUT/DELETE /api/tournaments/:id` — Update / Delete
- `PUT/GET /api/tournaments/:id/schedule` — Set / Get schedule config

### Teams & Players
- `GET/POST /api/teams` — List (by tournament) / Add team
- `PUT/DELETE /api/teams/:id` — Update / Delete team
- `GET/POST /api/players` — List (by team) / Add player
- `PUT/DELETE /api/players/:id` — Update / Remove player

### Venues
- `GET/POST /api/venues` — List / Add venue
- `PUT/DELETE /api/venues/:id` — Update / Delete venue
- `GET/POST /api/venue-availability` — List / Add slot
- `PUT/DELETE /api/venue-availability/:id` — Update / Delete slot

### Team Availability
- `GET/POST /api/team-availability` — List / Add slot
- `PUT/DELETE /api/team-availability/:id` — Update / Delete slot

### Fixtures (Sprint 3)
- `POST /api/fixtures/generate` — Generate fixtures from teams
- `POST /api/fixtures/schedule` — Auto-schedule all fixtures
- `GET /api/fixtures?tournament_id=X` — View all fixtures
- `GET /api/fixtures/plan?tournament_id=X` — Full tournament plan
- `GET /api/fixtures/conflicts?tournament_id=X` — Conflict report
