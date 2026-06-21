-- 正式 schema 扩展：试卷快照、批改提交（配合 database-schema.sql 使用）

CREATE TABLE IF NOT EXISTS grading_submission (
  id VARCHAR(64) PRIMARY KEY,
  paper_no VARCHAR(64) NOT NULL,
  student_id VARCHAR(64),
  assignment_id VARCHAR(64),
  image_path VARCHAR(500) NOT NULL,
  image_name VARCHAR(255),
  corrected_image_path VARCHAR(500),
  mode VARCHAR(32) NOT NULL DEFAULT 'ocr',
  accuracy INT NOT NULL DEFAULT 0,
  earned_score DECIMAL(8,2) NOT NULL DEFAULT 0,
  total_score DECIMAL(8,2) NOT NULL DEFAULT 0,
  details_json JSON,
  wrong_points_json JSON,
  feedback TEXT,
  review_status VARCHAR(32) NOT NULL DEFAULT 'pending',
  review_json JSON,
  needs_review INT NOT NULL DEFAULT 0,
  preprocessing_json JSON,
  marker_detection_json JSON,
  graded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_gs_paper (paper_no),
  INDEX idx_gs_student (student_id)
);
