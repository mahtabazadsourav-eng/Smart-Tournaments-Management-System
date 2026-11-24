-- Smart Tournament Planner - Sprint 4 migration
-- Run this against the existing smart_tournament database.

USE smart_tournament;

CREATE TABLE IF NOT EXISTS match_results (
  id INT AUTO_INCREMENT PRIMARY KEY,
  fixture_id INT NOT NULL UNIQUE,
  team1_score DECIMAL(10,2) NOT NULL,
  team2_score DECIMAL(10,2) NOT NULL,
  outcome ENUM('TEAM1_WIN','TEAM2_WIN','DRAW') NOT NULL,
  recorded_by INT DEFAULT NULL,
  recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_match_results_fixture
    FOREIGN KEY (fixture_id) REFERENCES fixtures(id) ON DELETE CASCADE,
  CONSTRAINT fk_match_results_user
    FOREIGN KEY (recorded_by) REFERENCES users(id) ON DELETE SET NULL
);
