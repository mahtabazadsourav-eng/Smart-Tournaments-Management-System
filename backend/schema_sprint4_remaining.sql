-- Sprint 4 remaining-work migration for an existing smart_tournament database.
-- Safe to execute more than once. It does not drop or rewrite existing tournament data.
USE smart_tournament;

CREATE TABLE IF NOT EXISTS fixture_bracket_links (
  target_fixture_id INT NOT NULL PRIMARY KEY,
  source_fixture1_id INT NOT NULL,
  source_fixture2_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_bracket_target_fixture FOREIGN KEY (target_fixture_id)
    REFERENCES fixtures(id) ON DELETE CASCADE,
  CONSTRAINT fk_bracket_source_fixture1 FOREIGN KEY (source_fixture1_id)
    REFERENCES fixtures(id) ON DELETE CASCADE,
  CONSTRAINT fk_bracket_source_fixture2 FOREIGN KEY (source_fixture2_id)
    REFERENCES fixtures(id) ON DELETE CASCADE
);
