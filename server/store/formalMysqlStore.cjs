const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { filterQuestions } = require('./jsonStore.cjs');

const STATUS_TO_FORMAL = { 已入库: 'published', 待确认: 'pending_review', 草稿: 'draft' };
const STATUS_FROM_FORMAL = { published: '已入库', pending_review: '待确认', draft: '草稿', disabled: '已禁用' };

function mapStatusToFormal(status) {
  return STATUS_TO_FORMAL[status] || 'published';
}

function mapStatusFromFormal(status) {
  return STATUS_FROM_FORMAL[status] || status;
}

async function loadOptions(pool, questionIds) {
  if (!questionIds.length) return new Map();
  const [rows] = await pool.query(
    `SELECT question_id, option_key, option_content, sort_no FROM question_option WHERE question_id IN (${questionIds.map(() => '?').join(',')}) ORDER BY sort_no`,
    questionIds
  );
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.question_id)) map.set(row.question_id, []);
    map.get(row.question_id).push(row.option_content);
  }
  return map;
}

async function loadKnowledge(pool, questionIds) {
  if (!questionIds.length) return new Map();
  const [rows] = await pool.query(
    `SELECT qkr.question_id, kp.name FROM question_knowledge_relation qkr
     JOIN knowledge_point kp ON kp.id = qkr.knowledge_id
     WHERE qkr.question_id IN (${questionIds.map(() => '?').join(',')})`,
    questionIds
  );
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.question_id)) map.set(row.question_id, row.name);
  }
  return map;
}

function rowToQuestion(row, options = [], knowledge = '') {
  return {
    id: row.question_no,
    section: row.section_title,
    type: row.question_type,
    stem: row.stem,
    options,
    answer: row.answer || '',
    analysis: row.analysis || '',
    subject: row.subject,
    knowledge: knowledge || '待绑定',
    difficulty: row.difficulty,
    score: Number(row.score || 0),
    source: row.source || '',
    status: mapStatusFromFormal(row.status),
    createdAt: row.created_at ? String(row.created_at).slice(0, 10) : '',
    updatedAt: row.updated_at ? String(row.updated_at).slice(0, 10) : undefined,
    _internalId: row.id,
  };
}

function createFormalMysqlStore(pool) {
  return {
    mode: 'mysql-formal',
    pool,

    async init() {
      const schemaPath = path.join(__dirname, '..', '..', 'database-schema.sql');
      const extPath = path.join(__dirname, '..', 'sql', 'formal-extensions.sql');
      const schema = await fs.readFile(schemaPath, 'utf-8');
      for (const stmt of schema.split(';').map((s) => s.trim()).filter(Boolean)) {
        try { await pool.query(stmt); } catch (err) {
          if (!/already exists/i.test(err.message)) throw err;
        }
      }
      const ext = await fs.readFile(extPath, 'utf-8');
      for (const stmt of ext.split(';').map((s) => s.trim()).filter(Boolean)) {
        try { await pool.query(stmt); } catch (err) {
          if (!/already exists/i.test(err.message)) throw err;
        }
      }
      const alters = [
        'ALTER TABLE paper ADD COLUMN student_id VARCHAR(64)',
        'ALTER TABLE paper ADD COLUMN assignment_id VARCHAR(64)',
        'ALTER TABLE paper ADD COLUMN layout_json JSON',
        'ALTER TABLE paper ADD COLUMN template_version VARCHAR(16) DEFAULT \'1.0\'',
      ];
      for (const stmt of alters) {
        try { await pool.query(stmt); } catch { /* exists */ }
      }
    },

    async listQuestions(query) {
      const [rows] = await pool.query('SELECT * FROM question ORDER BY created_at DESC');
      const ids = rows.map((r) => r.id);
      const optionsMap = await loadOptions(pool, ids);
      const knowledgeMap = await loadKnowledge(pool, ids);
      const mapped = rows.map((r) => rowToQuestion(r, optionsMap.get(r.id) || [], knowledgeMap.get(r.id) || ''));
      return filterQuestions(mapped, query);
    },

    async createQuestions(items) {
      for (const item of items) {
        const questionNo = item.id || crypto.randomUUID();
        const [existing] = await pool.query('SELECT id FROM question WHERE question_no = ? LIMIT 1', [questionNo]);
        let questionId = existing[0]?.id;
        if (!questionId) {
          const [result] = await pool.query(
            `INSERT INTO question (question_no, section_title, question_type, subject, difficulty, score, stem, answer, analysis, source, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [questionNo, item.section || '', item.type || '单选题', item.subject || '数学', item.difficulty || '中等', Number(item.score || 5), item.stem || '', item.answer || '', item.analysis || '', item.source || '接口入库', mapStatusToFormal(item.status || '已入库')]
          );
          questionId = result.insertId;
        }
        await pool.query('DELETE FROM question_option WHERE question_id = ?', [questionId]);
        const options = item.options || [];
        for (const [idx, content] of options.entries()) {
          const key = String.fromCharCode(65 + idx);
          await pool.query(
            'INSERT INTO question_option (question_id, option_key, option_content, is_correct, sort_no) VALUES (?, ?, ?, ?, ?)',
            [questionId, key, content, Number(item.answer?.includes(key)), idx]
          );
        }
        if (item.knowledge) {
          const [kpRows] = await pool.query('SELECT id FROM knowledge_point WHERE subject = ? AND name = ? LIMIT 1', [item.subject || '数学', item.knowledge]);
          let kpId = kpRows[0]?.id;
          if (!kpId) {
            const [kpIns] = await pool.query('INSERT INTO knowledge_point (subject, name, path, level_no) VALUES (?, ?, ?, 1)', [item.subject || '数学', item.knowledge, item.knowledge]);
            kpId = kpIns.insertId;
          }
          await pool.query('INSERT IGNORE INTO question_knowledge_relation (question_id, knowledge_id) VALUES (?, ?)', [questionId, kpId]);
        }
        item.id = questionNo;
      }
      return items;
    },

    async updateQuestion(id, patch) {
      const [rows] = await pool.query('SELECT * FROM question WHERE question_no = ? LIMIT 1', [id]);
      if (!rows[0]) return null;
      const merged = { ...rowToQuestion(rows[0]), ...patch, id };
      await pool.query(
        `UPDATE question SET section_title=?, question_type=?, subject=?, difficulty=?, score=?, stem=?, answer=?, analysis=?, source=?, status=?, updated_at=CURRENT_TIMESTAMP WHERE question_no=?`,
        [merged.section, merged.type, merged.subject, merged.difficulty, merged.score, merged.stem, merged.answer, merged.analysis, merged.source, mapStatusToFormal(merged.status), id]
      );
      if (patch.options) {
        await pool.query('DELETE FROM question_option WHERE question_id = ?', [rows[0].id]);
        for (const [idx, content] of patch.options.entries()) {
          const key = String.fromCharCode(65 + idx);
          await pool.query(
            'INSERT INTO question_option (question_id, option_key, option_content, is_correct, sort_no) VALUES (?, ?, ?, ?, ?)',
            [rows[0].id, key, content, Number((patch.answer || merged.answer || '').includes(key)), idx]
          );
        }
      }
      return merged;
    },

    async deleteQuestion(id) {
      const [rows] = await pool.query('SELECT id FROM question WHERE question_no = ? LIMIT 1', [id]);
      if (rows[0]) await pool.query('DELETE FROM question WHERE id = ?', [rows[0].id]);
      const [count] = await pool.query('SELECT COUNT(*) AS c FROM question');
      return count[0].c;
    },

    async savePaper(paper) {
      await pool.query(
        `INSERT INTO paper (paper_no, title, subject, total_score, template_type, status, student_id, assignment_id, layout_json, template_version)
         VALUES (?, ?, ?, ?, 'answer_card', 'draft', ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE title=VALUES(title), subject=VALUES(subject), total_score=VALUES(total_score), student_id=VALUES(student_id), assignment_id=VALUES(assignment_id), layout_json=VALUES(layout_json), template_version=VALUES(template_version)`,
        [paper.id, paper.title, paper.subject, paper.totalScore, paper.studentId || null, paper.assignmentId || null, JSON.stringify(paper.answerSheetLayout || null), paper.templateVersion || '1.0']
      );
      const [paperRows] = await pool.query('SELECT id FROM paper WHERE paper_no = ? LIMIT 1', [paper.id]);
      const paperId = paperRows[0].id;
      await pool.query('DELETE FROM paper_question WHERE paper_id = ?', [paperId]);
      for (const [idx, q] of (paper.questions || []).entries()) {
        const [qRows] = await pool.query('SELECT id FROM question WHERE question_no = ? LIMIT 1', [q.id]);
        if (!qRows[0]) continue;
        await pool.query('INSERT INTO paper_question (paper_id, question_id, sort_no, score) VALUES (?, ?, ?, ?)', [paperId, qRows[0].id, idx + 1, Number(q.score || 0)]);
      }
      return paper;
    },

    async getPaper(id) {
      const [rows] = await pool.query('SELECT * FROM paper WHERE paper_no = ? LIMIT 1', [id]);
      if (!rows[0]) return null;
      const paper = rows[0];
      const [pqRows] = await pool.query(
        `SELECT pq.sort_no, pq.score AS paper_score, q.* FROM paper_question pq
         JOIN question q ON q.id = pq.question_id WHERE pq.paper_id = ? ORDER BY pq.sort_no`,
        [paper.id]
      );
      const qIds = pqRows.map((r) => r.id);
      const optionsMap = await loadOptions(pool, qIds);
      const knowledgeMap = await loadKnowledge(pool, qIds);
      const questions = pqRows.map((r) => ({
        ...rowToQuestion(r, optionsMap.get(r.id) || [], knowledgeMap.get(r.id) || ''),
        sortNo: r.sort_no,
        score: Number(r.paper_score || r.score || 0),
      }));
      const layout = paper.layout_json ? (typeof paper.layout_json === 'string' ? JSON.parse(paper.layout_json) : paper.layout_json) : null;
      return {
        id: paper.paper_no,
        title: paper.title,
        subject: paper.subject,
        studentId: paper.student_id,
        assignmentId: paper.assignment_id,
        totalScore: Number(paper.total_score || 0),
        templateVersion: paper.template_version || '1.0',
        questions,
        answerSheetLayout: layout,
        createdAt: paper.created_at,
      };
    },

    async saveGrading(grading) {
      await pool.query(
        `INSERT INTO grading_submission (id, paper_no, student_id, assignment_id, image_path, image_name, corrected_image_path, mode, accuracy, earned_score, total_score, details_json, wrong_points_json, feedback, review_status, review_json, needs_review, preprocessing_json, marker_detection_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [grading.id, grading.paperId, grading.studentId || null, grading.assignmentId || null, grading.imagePath, grading.imageName || null, grading.correctedImagePath || null, grading.mode, grading.accuracy, grading.earnedScore, grading.totalScore, JSON.stringify(grading.details || []), JSON.stringify(grading.wrongPoints || []), grading.feedback || '', grading.reviewStatus || 'pending', JSON.stringify(grading.review || null), grading.needsReview || 0, JSON.stringify(grading.preprocessing || []), JSON.stringify(grading.markerDetection || null)]
      );
      return grading;
    },

    async getGrading(id) {
      const [rows] = await pool.query('SELECT * FROM grading_submission WHERE id = ? LIMIT 1', [id]);
      if (!rows[0]) return null;
      const row = rows[0];
      return {
        id: row.id,
        paperId: row.paper_no,
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
        reviewStatus: row.review_status,
        needsReview: row.needs_review,
        review: row.review_json ? (typeof row.review_json === 'string' ? JSON.parse(row.review_json) : row.review_json) : null,
        markerDetection: row.marker_detection_json ? (typeof row.marker_detection_json === 'string' ? JSON.parse(row.marker_detection_json) : row.marker_detection_json) : null,
        preprocessing: row.preprocessing_json ? (typeof row.preprocessing_json === 'string' ? JSON.parse(row.preprocessing_json) : row.preprocessing_json) : [],
        gradedAt: row.graded_at,
      };
    },

    async updateGrading(id, patch) {
      const current = await this.getGrading(id);
      if (!current) return null;
      const merged = { ...current, ...patch, id };
      await pool.query(
        `UPDATE grading_submission SET earned_score=?, total_score=?, accuracy=?, details_json=?, wrong_points_json=?, feedback=?, review_status=?, review_json=?, needs_review=?, mode=? WHERE id=?`,
        [merged.earnedScore, merged.totalScore, merged.accuracy, JSON.stringify(merged.details || []), JSON.stringify(merged.wrongPoints || []), merged.feedback || '', merged.reviewStatus || 'reviewed', JSON.stringify(merged.review || null), merged.needsReview || 0, merged.mode, id]
      );
      return merged;
    },

    async listGradings(query = {}) {
      let sql = 'SELECT * FROM grading_submission WHERE 1=1';
      const params = [];
      if (query.studentId) { sql += ' AND student_id = ?'; params.push(query.studentId); }
      if (query.paperId) { sql += ' AND paper_no = ?'; params.push(query.paperId); }
      sql += ' ORDER BY graded_at DESC';
      const [rows] = await pool.query(sql, params);
      return rows.map((row) => ({
        id: row.id,
        paperId: row.paper_no,
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
        reviewStatus: row.review_status,
        needsReview: row.needs_review,
        review: row.review_json ? (typeof row.review_json === 'string' ? JSON.parse(row.review_json) : row.review_json) : null,
        markerDetection: row.marker_detection_json ? (typeof row.marker_detection_json === 'string' ? JSON.parse(row.marker_detection_json) : row.marker_detection_json) : null,
        preprocessing: row.preprocessing_json ? (typeof row.preprocessing_json === 'string' ? JSON.parse(row.preprocessing_json) : row.preprocessing_json) : [],
        gradedAt: row.graded_at,
      }));
    },
  };
}

module.exports = { createFormalMysqlStore };
