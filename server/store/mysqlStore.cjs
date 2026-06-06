const fs = require('fs/promises');
const path = require('path');
const mysql = require('mysql2/promise');
const { filterQuestions } = require('./jsonStore.cjs');

function rowToQuestion(row) {
  const options = row.options_json ? (typeof row.options_json === 'string' ? JSON.parse(row.options_json) : row.options_json) : [];
  return {
    id: row.id,
    section: row.section_title,
    type: row.question_type,
    stem: row.stem,
    options: options || [],
    answer: row.answer || '',
    analysis: row.analysis || '',
    subject: row.subject,
    knowledge: row.knowledge || '',
    difficulty: row.difficulty,
    score: Number(row.score || 0),
    source: row.source || '',
    status: row.status,
    createdAt: row.created_at ? String(row.created_at).slice(0, 10) : '',
    updatedAt: row.updated_at ? String(row.updated_at).slice(0, 10) : undefined,
  };
}

function questionToRow(item) {
  return {
    id: item.id,
    section_title: item.section || item.section_title || '',
    question_type: item.type || item.question_type || '单选题',
    subject: item.subject || '数学',
    knowledge: item.knowledge || '待绑定',
    difficulty: item.difficulty || '中等',
    score: Number(item.score || 5),
    stem: item.stem || '',
    options_json: JSON.stringify(item.options || []),
    answer: item.answer || '',
    analysis: item.analysis || '',
    source: item.source || '接口入库',
    status: item.status || '已入库',
  };
}

function rowToPaper(row) {
  const questions = row.questions_json ? (typeof row.questions_json === 'string' ? JSON.parse(row.questions_json) : row.questions_json) : [];
  const layout = row.layout_json ? (typeof row.layout_json === 'string' ? JSON.parse(row.layout_json) : row.layout_json) : null;
  return {
    id: row.id,
    title: row.title,
    subject: row.subject,
    studentId: row.student_id,
    assignmentId: row.assignment_id,
    totalScore: Number(row.total_score || 0),
    templateVersion: row.template_version,
    questions,
    answerSheetLayout: layout,
    createdAt: row.created_at,
  };
}

function rowToGrading(row) {
  return {
    id: row.id,
    paperId: row.paper_id,
    studentId: row.student_id,
    assignmentId: row.assignment_id,
    imagePath: row.image_path,
    imageName: row.image_name,
    correctedImagePath: row.corrected_image_path,
    mode: row.mode,
    accuracy: row.accuracy,
    earnedScore: Number(row.earned_score || 0),
    totalScore: Number(row.total_score || 0),
    details: row.details_json ? (typeof row.details_json === 'string' ? JSON.parse(row.details_json) : row.details_json) : [],
    wrongPoints: row.wrong_points_json ? (typeof row.wrong_points_json === 'string' ? JSON.parse(row.wrong_points_json) : row.wrong_points_json) : [],
    feedback: row.feedback,
    gradedAt: row.graded_at,
  };
}

function createMysqlStore(pool) {
  return {
    mode: 'mysql',
    pool,

    async init() {
      const sqlPath = path.join(__dirname, '..', 'sql', 'init-runtime.sql');
      const sql = await fs.readFile(sqlPath, 'utf-8');
      for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) {
        await pool.query(stmt);
      }
    },

    async listQuestions(query) {
      const rows = await pool.query('SELECT * FROM znzy_question ORDER BY created_at DESC');
      return filterQuestions(rows[0].map(rowToQuestion), query);
    },

    async createQuestions(items) {
      for (const item of items) {
        const row = questionToRow(item);
        await pool.query(
          `INSERT INTO znzy_question (id, section_title, question_type, subject, knowledge, difficulty, score, stem, options_json, answer, analysis, source, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
           section_title=VALUES(section_title), question_type=VALUES(question_type), subject=VALUES(subject),
           knowledge=VALUES(knowledge), difficulty=VALUES(difficulty), score=VALUES(score), stem=VALUES(stem),
           options_json=VALUES(options_json), answer=VALUES(answer), analysis=VALUES(analysis),
           source=VALUES(source), status=VALUES(status), updated_at=CURRENT_TIMESTAMP`,
          [row.id, row.section_title, row.question_type, row.subject, row.knowledge, row.difficulty, row.score, row.stem, row.options_json, row.answer, row.analysis, row.source, row.status]
        );
      }
      return items;
    },

    async updateQuestion(id, patch) {
      const current = await pool.query('SELECT * FROM znzy_question WHERE id = ? LIMIT 1', [id]);
      if (!current[0].length) return null;
      const merged = { ...rowToQuestion(current[0][0]), ...patch, id };
      const row = questionToRow(merged);
      await pool.query(
        `UPDATE znzy_question SET section_title=?, question_type=?, subject=?, knowledge=?, difficulty=?, score=?, stem=?, options_json=?, answer=?, analysis=?, source=?, status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
        [row.section_title, row.question_type, row.subject, row.knowledge, row.difficulty, row.score, row.stem, row.options_json, row.answer, row.analysis, row.source, row.status, id]
      );
      return merged;
    },

    async deleteQuestion(id) {
      await pool.query('DELETE FROM znzy_question WHERE id = ?', [id]);
      const count = await pool.query('SELECT COUNT(*) AS c FROM znzy_question');
      return count[0][0].c;
    },

    async savePaper(paper) {
      await pool.query(
        `INSERT INTO znzy_paper (id, title, subject, student_id, assignment_id, total_score, template_version, questions_json, layout_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE title=VALUES(title), subject=VALUES(subject), student_id=VALUES(student_id),
         assignment_id=VALUES(assignment_id), total_score=VALUES(total_score), template_version=VALUES(template_version),
         questions_json=VALUES(questions_json), layout_json=VALUES(layout_json)`,
        [paper.id, paper.title, paper.subject, paper.studentId || null, paper.assignmentId || null, paper.totalScore, paper.templateVersion || '1.0', JSON.stringify(paper.questions || []), JSON.stringify(paper.answerSheetLayout || null)]
      );
      return paper;
    },

    async getPaper(id) {
      const rows = await pool.query('SELECT * FROM znzy_paper WHERE id = ? LIMIT 1', [id]);
      return rows[0][0] ? rowToPaper(rows[0][0]) : null;
    },

    async saveGrading(grading) {
      await pool.query(
        `INSERT INTO znzy_grading (id, paper_id, student_id, assignment_id, image_path, image_name, corrected_image_path, mode, accuracy, earned_score, total_score, details_json, wrong_points_json, feedback)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [grading.id, grading.paperId, grading.studentId || null, grading.assignmentId || null, grading.imagePath, grading.imageName || null, grading.correctedImagePath || null, grading.mode, grading.accuracy, grading.earnedScore, grading.totalScore, JSON.stringify(grading.details || []), JSON.stringify(grading.wrongPoints || []), grading.feedback || '']
      );
      return grading;
    },

    async listGradings(query = {}) {
      let sql = 'SELECT * FROM znzy_grading WHERE 1=1';
      const params = [];
      if (query.studentId) { sql += ' AND student_id = ?'; params.push(query.studentId); }
      if (query.paperId) { sql += ' AND paper_id = ?'; params.push(query.paperId); }
      sql += ' ORDER BY graded_at DESC';
      const rows = await pool.query(sql, params);
      return rows[0].map(rowToGrading);
    },
  };
}

module.exports = { createMysqlStore };
