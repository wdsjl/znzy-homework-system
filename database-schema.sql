-- 智能作业题库数据库核心表结构
-- 适用：MySQL 8.x，可按需调整为 PostgreSQL

CREATE TABLE question_import_batch (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  batch_no VARCHAR(64) NOT NULL UNIQUE,
  file_name VARCHAR(255),
  file_url VARCHAR(500),
  source_type VARCHAR(32) NOT NULL COMMENT 'paste/docx/excel/api',
  subject VARCHAR(32),
  grade VARCHAR(32),
  textbook_version VARCHAR(64),
  status VARCHAR(32) NOT NULL DEFAULT 'pending' COMMENT 'pending/parsed/confirmed/failed',
  total_count INT NOT NULL DEFAULT 0,
  success_count INT NOT NULL DEFAULT 0,
  fail_count INT NOT NULL DEFAULT 0,
  created_by BIGINT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE knowledge_point (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  parent_id BIGINT DEFAULT NULL,
  subject VARCHAR(32) NOT NULL,
  grade VARCHAR(32),
  textbook_version VARCHAR(64),
  name VARCHAR(128) NOT NULL,
  path VARCHAR(500),
  level_no INT NOT NULL DEFAULT 1,
  sort_no INT NOT NULL DEFAULT 0,
  status TINYINT NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_kp_subject_grade (subject, grade),
  INDEX idx_kp_parent (parent_id)
);

CREATE TABLE question (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  question_no VARCHAR(64) NOT NULL UNIQUE,
  import_batch_id BIGINT,
  section_title VARCHAR(128) COMMENT '一、单选题',
  question_type VARCHAR(32) NOT NULL COMMENT '单选题/多选题/判断题/填空题/解答题',
  subject VARCHAR(32) NOT NULL,
  grade VARCHAR(32),
  textbook_version VARCHAR(64),
  difficulty VARCHAR(32) NOT NULL DEFAULT '中等',
  score DECIMAL(6,2) NOT NULL DEFAULT 5,
  stem TEXT NOT NULL,
  stem_html MEDIUMTEXT,
  answer TEXT,
  analysis MEDIUMTEXT,
  source VARCHAR(128),
  status VARCHAR(32) NOT NULL DEFAULT 'draft' COMMENT 'draft/pending_review/published/disabled',
  duplicate_hash VARCHAR(64),
  created_by BIGINT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_question_type (question_type),
  INDEX idx_question_subject (subject, grade),
  INDEX idx_question_status (status),
  INDEX idx_question_hash (duplicate_hash),
  CONSTRAINT fk_question_batch FOREIGN KEY (import_batch_id) REFERENCES question_import_batch(id)
);

CREATE TABLE question_option (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  question_id BIGINT NOT NULL,
  option_key VARCHAR(8) NOT NULL COMMENT 'A/B/C/D',
  option_content TEXT,
  option_html MEDIUMTEXT,
  is_correct TINYINT NOT NULL DEFAULT 0,
  sort_no INT NOT NULL DEFAULT 0,
  CONSTRAINT fk_option_question FOREIGN KEY (question_id) REFERENCES question(id) ON DELETE CASCADE,
  INDEX idx_option_question (question_id)
);

CREATE TABLE question_knowledge_relation (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  question_id BIGINT NOT NULL,
  knowledge_id BIGINT NOT NULL,
  weight DECIMAL(5,2) NOT NULL DEFAULT 1,
  CONSTRAINT fk_qk_question FOREIGN KEY (question_id) REFERENCES question(id) ON DELETE CASCADE,
  CONSTRAINT fk_qk_knowledge FOREIGN KEY (knowledge_id) REFERENCES knowledge_point(id),
  UNIQUE KEY uk_question_knowledge (question_id, knowledge_id)
);

CREATE TABLE question_tag (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(64) NOT NULL UNIQUE,
  tag_type VARCHAR(32) COMMENT '易错/高频/真题/拓展/压轴',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE question_tag_relation (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  question_id BIGINT NOT NULL,
  tag_id BIGINT NOT NULL,
  CONSTRAINT fk_qt_question FOREIGN KEY (question_id) REFERENCES question(id) ON DELETE CASCADE,
  CONSTRAINT fk_qt_tag FOREIGN KEY (tag_id) REFERENCES question_tag(id),
  UNIQUE KEY uk_question_tag (question_id, tag_id)
);

CREATE TABLE question_asset (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  question_id BIGINT NOT NULL,
  asset_type VARCHAR(32) NOT NULL COMMENT 'image/formula/geometry/audio',
  file_url VARCHAR(500) NOT NULL,
  original_name VARCHAR(255),
  placeholder VARCHAR(64) COMMENT '题干中的占位符，如 {{image_1}}',
  sort_no INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_asset_question FOREIGN KEY (question_id) REFERENCES question(id) ON DELETE CASCADE,
  INDEX idx_asset_question (question_id)
);

CREATE TABLE question_parse_log (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  batch_id BIGINT NOT NULL,
  raw_text MEDIUMTEXT,
  parsed_json JSON,
  error_message TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_parse_batch FOREIGN KEY (batch_id) REFERENCES question_import_batch(id) ON DELETE CASCADE
);

CREATE TABLE paper (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  paper_no VARCHAR(64) NOT NULL UNIQUE,
  title VARCHAR(255) NOT NULL,
  subject VARCHAR(32) NOT NULL,
  grade VARCHAR(32),
  total_score DECIMAL(8,2) NOT NULL DEFAULT 0,
  duration_minutes INT,
  template_type VARCHAR(32) NOT NULL DEFAULT 'standard' COMMENT 'standard/simple/answer_card',
  status VARCHAR(32) NOT NULL DEFAULT 'draft',
  created_by BIGINT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE paper_question (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  paper_id BIGINT NOT NULL,
  question_id BIGINT NOT NULL,
  sort_no INT NOT NULL DEFAULT 0,
  score DECIMAL(6,2) NOT NULL DEFAULT 0,
  CONSTRAINT fk_pq_paper FOREIGN KEY (paper_id) REFERENCES paper(id) ON DELETE CASCADE,
  CONSTRAINT fk_pq_question FOREIGN KEY (question_id) REFERENCES question(id),
  UNIQUE KEY uk_paper_question (paper_id, question_id)
);

CREATE TABLE answer_sheet_layout (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  layout_no VARCHAR(64) NOT NULL UNIQUE,
  paper_no VARCHAR(64) NOT NULL,
  student_no VARCHAR(64),
  assignment_no VARCHAR(64),
  template_version VARCHAR(64) NOT NULL DEFAULT 'answer-sheet-v1',
  layout_json JSON NOT NULL COMMENT 'A4 页面、定位点、二维码区、每题答题区域坐标',
  qr_payload_json JSON NOT NULL COMMENT 'paperId/studentId/assignmentId/templateVersion',
  qr_data_url MEDIUMTEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_layout_paper (paper_no),
  INDEX idx_layout_student_assignment (student_no, assignment_no)
);

CREATE TABLE grading_submission (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  upload_no VARCHAR(64) NOT NULL UNIQUE,
  paper_no VARCHAR(64),
  assignment_no VARCHAR(64),
  student_no VARCHAR(64),
  student_name VARCHAR(64),
  file_name VARCHAR(255),
  image_url VARCHAR(500),
  recognition_engine VARCHAR(64),
  recognized_json JSON,
  grading_json JSON,
  review_json JSON COMMENT '主观题人工复核记录',
  processing_json JSON COMMENT '图像预处理、OMR、OCR 和主观题裁剪结果',
  score DECIMAL(8,2) NOT NULL DEFAULT 0,
  total_score DECIMAL(8,2) NOT NULL DEFAULT 0,
  objective_score DECIMAL(8,2) NOT NULL DEFAULT 0,
  objective_full_score DECIMAL(8,2) NOT NULL DEFAULT 0,
  accuracy DECIMAL(6,2) NOT NULL DEFAULT 0,
  manual_review_count INT NOT NULL DEFAULT 0,
  feedback TEXT,
  status VARCHAR(32) NOT NULL DEFAULT 'graded' COMMENT 'graded/manual_review/done',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_grading_student (student_no),
  INDEX idx_grading_assignment (assignment_no),
  INDEX idx_grading_paper (paper_no),
  INDEX idx_grading_status (status)
);

CREATE TABLE grading_question_result (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  upload_no VARCHAR(64) NOT NULL,
  question_no INT NOT NULL,
  question_id VARCHAR(64),
  question_type VARCHAR(32),
  result_kind VARCHAR(32) COMMENT 'objective/subjective',
  recognized_answer TEXT,
  correct_answer TEXT,
  score DECIMAL(6,2) NOT NULL DEFAULT 0,
  full_score DECIMAL(6,2) NOT NULL DEFAULT 0,
  is_correct TINYINT NULL,
  status VARCHAR(32) NOT NULL COMMENT 'correct/wrong/needs_manual_review',
  result_json JSON,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_gqr_upload (upload_no),
  INDEX idx_gqr_question (question_id),
  CONSTRAINT fk_gqr_upload FOREIGN KEY (upload_no) REFERENCES grading_submission(upload_no) ON DELETE CASCADE
);

CREATE TABLE grading_job (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  job_no VARCHAR(64) NOT NULL UNIQUE,
  upload_no VARCHAR(64),
  student_no VARCHAR(64),
  assignment_no VARCHAR(64),
  paper_no VARCHAR(64),
  file_name VARCHAR(255),
  status VARCHAR(32) NOT NULL DEFAULT 'queued' COMMENT 'queued/processing/done/failed',
  progress INT NOT NULL DEFAULT 0,
  stage VARCHAR(64),
  error_message TEXT,
  result_json JSON,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_grading_job_student (student_no),
  INDEX idx_grading_job_assignment (assignment_no),
  INDEX idx_grading_job_status (status)
);
