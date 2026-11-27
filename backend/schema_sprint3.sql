-- Sprint 3 fixtures schema. Run after schema_full.sql has created
-- tournaments, teams, and venues.
CREATE TABLE IF NOT EXISTS fixtures (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  tournament_id     INT NOT NULL,
  round             INT NOT NULL,
  team1_id          INT NOT NULL,
  team2_id          INT DEFAULT NULL,
  match_date        DATE DEFAULT NULL,
  match_start_time  TIME DEFAULT NULL,
  match_end_time    TIME DEFAULT NULL,
  venue_id          INT DEFAULT NULL,
  is_bye            TINYINT(1) NOT NULL DEFAULT 0,
  status            ENUM('UNSCHEDULED','SCHEDULED','COMPLETED','CANCELLED') NOT NULL DEFAULT 'UNSCHEDULED',
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE,
  FOREIGN KEY (team1_id) REFERENCES teams(id) ON DELETE CASCADE,
  FOREIGN KEY (team2_id) REFERENCES teams(id) ON DELETE SET NULL,
  FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE SET NULL,
  INDEX idx_fixtures_tournament_round (tournament_id, round),
  INDEX idx_fixtures_schedule (tournament_id, match_date, match_start_time)
);
