-- 智能作业系统运行时表结构（UUID 友好，可与 database-schema.sql 正式版并行演进）
-- 适用 MySQL 8.x

CREATE TABLE IF NOT EXISTS znzy_question (
  id VARCHAR(64) PRIMARY KEY,
  section_title VARCHAR(128),
  question_type VARCHAR(32) NOT NULL,
  subject VARCHAR(32) NOT NULL,
  knowledge VARCHAR(128),
  difficulty VARCHAR(32) NOT NULL DEFAULT '中等',
  score DECIMAL(6,2) NOT NULL DEFAULT 5,
  stem TEXT NOT NULL,
  options_json JSON,
  answer TEXT,
  analysis MEDIUMTEXT,
  source VARCHAR(128),
  status VARCHAR(32) NOT NULL DEFAULT '已入库',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_zq_type (question_type),
  INDEX idx_zq_subject (subject),
  INDEX idx_zq_status (status)
);

CREATE TABLE IF NOT EXISTS znzy_paper (
  id VARCHAR(64) PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  subject VARCHAR(32) NOT NULL,
  student_id VARCHAR(64),
  assignment_id VARCHAR(64),
  total_score DECIMAL(8,2) NOT NULL DEFAULT 0,
  template_version VARCHAR(16) NOT NULL DEFAULT '1.0',
  questions_json JSON NOT NULL,
  layout_json JSON,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_zp_student (student_id),
  INDEX idx_zp_assignment (assignment_id)
);

CREATE TABLE IF NOT EXISTS znzy_grading (
  id VARCHAR(64) PRIMARY KEY,
  paper_id VARCHAR(64) NOT NULL,
  student_id VARCHAR(64),
  assignment_id VARCHAR(64),
  image_path VARCHAR(500) NOT NULL,
  image_name VARCHAR(255),
  corrected_image_path VARCHAR(500),
  mode VARCHAR(32) NOT NULL DEFAULT 'mock-ocr',
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
  INDEX idx_zg_paper (paper_id),
  INDEX idx_zg_student (student_id)
);
