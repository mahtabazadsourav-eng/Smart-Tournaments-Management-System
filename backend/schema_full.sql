-- Smart Tournament Planner - Full Database Schema
-- Covers Sprint 1, 2, 3, and 4

CREATE DATABASE IF NOT EXISTS smart_tournament;
USE smart_tournament;

-- Table: users
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(150) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('ADMIN','ORGANIZER','VENUE_COORDINATOR','TEAM_CAPTAIN_PLAYER','PLAYER') NOT NULL DEFAULT 'TEAM_CAPTAIN_PLAYER',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Keep existing databases compatible when adding regular player accounts.
ALTER TABLE users
  MODIFY role ENUM('ADMIN','ORGANIZER','VENUE_COORDINATOR','TEAM_CAPTAIN_PLAYER','PLAYER')
  NOT NULL DEFAULT 'TEAM_CAPTAIN_PLAYER';

-- Table: revoked_tokens
CREATE TABLE IF NOT EXISTS revoked_tokens (
  id INT AUTO_INCREMENT PRIMARY KEY,
  token_hash VARCHAR(64) NOT NULL UNIQUE,
  expires_at DATETIME NOT NULL,
  revoked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Table: tournaments
CREATE TABLE IF NOT EXISTS tournaments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  sport ENUM('CRICKET','FOOTBALL','FUTSAL') NOT NULL,
  format ENUM('KNOCKOUT','LEAGUE','GROUP_STAGE') NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  organizer_id INT NOT NULL,
  match_start_time TIME DEFAULT NULL,
  match_end_time TIME DEFAULT NULL,
  match_duration_minutes INT DEFAULT NULL,
  minimum_rest_minutes INT DEFAULT 30,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organizer_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Table: teams
CREATE TABLE IF NOT EXISTS teams (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tournament_id INT NOT NULL,
  team_name VARCHAR(100) NOT NULL,
  group_name VARCHAR(100) DEFAULT NULL,
  captain_id INT DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE,
  FOREIGN KEY (captain_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Table: team_players
CREATE TABLE IF NOT EXISTS team_players (
  id INT AUTO_INCREMENT PRIMARY KEY,
  team_id INT NOT NULL,
  user_id INT DEFAULT NULL,
  player_name VARCHAR(100) DEFAULT NULL,
  email VARCHAR(150) DEFAULT NULL,
  team_role ENUM('PLAYER','CAPTAIN','VICE_CAPTAIN') NOT NULL DEFAULT 'PLAYER',
  jersey_number INT DEFAULT NULL,
  player_position VARCHAR(50) DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Player accounts keep team membership separately from the organizer-managed roster.
CREATE TABLE IF NOT EXISTS player_team_memberships (
  user_id INT NOT NULL,
  team_id INT NOT NULL,
  joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, team_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
);

-- Table: venues
CREATE TABLE IF NOT EXISTS venues (
  id INT AUTO_INCREMENT PRIMARY KEY,
  venue_name VARCHAR(150) NOT NULL,
  location VARCHAR(200) NOT NULL,
  venue_type ENUM('CRICKET','FOOTBALL','FUTSAL') NOT NULL,
  capacity INT NOT NULL,
  coordinator_id INT DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (coordinator_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Table: venue_availability
CREATE TABLE IF NOT EXISTS venue_availability (
  id INT AUTO_INCREMENT PRIMARY KEY,
  venue_id INT NOT NULL,
  available_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  is_available TINYINT(1) DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE CASCADE
);

-- Venues selected by an organizer for a tournament.
CREATE TABLE IF NOT EXISTS tournament_venues (
  tournament_id INT NOT NULL,
  venue_id INT NOT NULL,
  availability_id INT DEFAULT NULL,
  selected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tournament_id, venue_id),
  FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE,
  FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE CASCADE,
  FOREIGN KEY (availability_id) REFERENCES venue_availability(id) ON DELETE SET NULL
);

-- Table: team_availability
CREATE TABLE IF NOT EXISTS team_availability (
  id INT AUTO_INCREMENT PRIMARY KEY,
  team_id INT NOT NULL,
  available_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  is_available TINYINT(1) DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
);

-- Table: fixtures (Sprint 3)
CREATE TABLE IF NOT EXISTS fixtures (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tournament_id INT NOT NULL,
  round INT NOT NULL,
  team1_id INT NOT NULL,
  team2_id INT,
  match_date DATE DEFAULT NULL,
  match_start_time TIME DEFAULT NULL,
  match_end_time TIME DEFAULT NULL,
  venue_id INT DEFAULT NULL,
  is_bye TINYINT(1) NOT NULL DEFAULT 0,
  status ENUM('UNSCHEDULED','SCHEDULED','COMPLETED','CANCELLED') DEFAULT 'UNSCHEDULED',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE,
  FOREIGN KEY (team1_id) REFERENCES teams(id) ON DELETE CASCADE,
  FOREIGN KEY (team2_id) REFERENCES teams(id) ON DELETE SET NULL,
  FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE SET NULL
);


-- Table: fixture_bracket_links (Sprint 4 knockout advancement)
-- Links each next-round fixture to the two feeder fixtures that produced it.
CREATE TABLE IF NOT EXISTS fixture_bracket_links (
  target_fixture_id INT NOT NULL PRIMARY KEY,
  source_fixture1_id INT NOT NULL,
  source_fixture2_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (target_fixture_id) REFERENCES fixtures(id) ON DELETE CASCADE,
  FOREIGN KEY (source_fixture1_id) REFERENCES fixtures(id) ON DELETE CASCADE,
  FOREIGN KEY (source_fixture2_id) REFERENCES fixtures(id) ON DELETE CASCADE
);


-- Table: match_results (Sprint 4)
CREATE TABLE IF NOT EXISTS match_results (
  id INT AUTO_INCREMENT PRIMARY KEY,
  fixture_id INT NOT NULL UNIQUE,
  team1_score DECIMAL(10,2) NOT NULL,
  team2_score DECIMAL(10,2) NOT NULL,
  outcome ENUM('TEAM1_WIN','TEAM2_WIN','DRAW') NOT NULL,
  recorded_by INT DEFAULT NULL,
  recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (fixture_id) REFERENCES fixtures(id) ON DELETE CASCADE,
  FOREIGN KEY (recorded_by) REFERENCES users(id) ON DELETE SET NULL
);
