const fs = require('fs/promises');
const path = require('path');
const mysql = require('mysql2/promise');

function createGradingStore({ dataDir }) {
  const layoutFile = path.join(dataDir, 'answer-sheet-layouts.json');
  const gradingFile = path.join(dataDir, 'grading-records.json');
  let pool;

  function mysqlConfigured() {
    return Boolean(
      process.env.STORAGE_DRIVER === 'mysql' ||
      process.env.DATABASE_URL ||
      process.env.MYSQL_HOST
    );
  }

  async function getPool() {
    if (pool) return pool;
    if (process.env.DATABASE_URL) {
      pool = mysql.createPool(process.env.DATABASE_URL);
      return pool;
    }
    pool = mysql.createPool({
      host: process.env.MYSQL_HOST || '127.0.0.1',
      port: Number(process.env.MYSQL_PORT || 3306),
      user: process.env.MYSQL_USER || 'root',
      password: process.env.MYSQL_PASSWORD || '',
      database: process.env.MYSQL_DATABASE || 'learning_diagnosis',
      waitForConnections: true,
      connectionLimit: Number(process.env.MYSQL_CONNECTION_LIMIT || 10),
      namedPlaceholders: true,
    });
    return pool;
  }

  async function withFallback(operation, fallback) {
    if (mysqlConfigured()) {
      try {
        return await operation();
      } catch (error) {
        if (process.env.STORAGE_STRICT === '1') throw error;
        console.warn(`[grading-store] mysql unavailable, falling back to JSON: ${error.message}`);
      }
    }
    return fallback();
  }

  async function readJson(file) {
    try {
      const text = await fs.readFile(file, 'utf-8');
      const rows = JSON.parse(text);
      return Array.isArray(rows) ? rows : [];
    } catch {
      return [];
    }
  }

  async function writeJson(file, rows) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(rows, null, 2), 'utf-8');
  }

  async function saveLayout(layout, qrDataUrl = '') {
    const row = normalizeLayout(layout, qrDataUrl);
    return withFallback(
      async () => {
        const db = await getPool();
        await db.execute(
          `INSERT INTO answer_sheet_layout
             (layout_no, paper_no, student_no, assignment_no, template_version, layout_json, qr_payload_json, qr_data_url)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             paper_no = VALUES(paper_no), student_no = VALUES(student_no), assignment_no = VALUES(assignment_no),
             template_version = VALUES(template_version), layout_json = VALUES(layout_json),
             qr_payload_json = VALUES(qr_payload_json), qr_data_url = VALUES(qr_data_url), updated_at = CURRENT_TIMESTAMP`,
          [
            row.layoutId,
            row.paperId,
            row.studentId,
            row.assignmentId,
            row.templateVersion,
            JSON.stringify(row.layout),
            JSON.stringify(row.qrPayload),
            row.qrDataUrl,
          ]
        );
        return row;
      },
      async () => {
        const rows = await readJson(layoutFile);
        const next = [row, ...rows.filter((item) => item.layoutId !== row.layoutId)].slice(0, 500);
        await writeJson(layoutFile, next);
        return row;
      }
    );
  }

  async function listLayouts(filters = {}) {
    return withFallback(
      async () => {
        const db = await getPool();
        const conditions = [];
        const values = [];
        if (filters.layoutId) {
          conditions.push('layout_no = ?');
          values.push(filters.layoutId);
        }
        if (filters.paperId) {
          conditions.push('paper_no = ?');
          values.push(filters.paperId);
        }
        if (filters.studentId) {
          conditions.push('student_no = ?');
          values.push(filters.studentId);
        }
        if (filters.assignmentId) {
          conditions.push('assignment_no = ?');
          values.push(filters.assignmentId);
        }
        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
        const [rows] = await db.query(
          `SELECT layout_no, paper_no, student_no, assignment_no, template_version, layout_json, qr_payload_json, qr_data_url, created_at, updated_at
           FROM answer_sheet_layout ${where} ORDER BY updated_at DESC LIMIT 100`,
          values
        );
        return rows.map((row) => ({
          layoutId: row.layout_no,
          paperId: row.paper_no,
          studentId: row.student_no || '',
          assignmentId: row.assignment_no || '',
          templateVersion: row.template_version,
          layout: parseJson(row.layout_json, {}),
          qrPayload: parseJson(row.qr_payload_json, {}),
          qrDataUrl: row.qr_data_url || '',
          createdAt: dateValue(row.created_at),
          updatedAt: dateValue(row.updated_at),
        }));
      },
      async () => filterRows(await readJson(layoutFile), filters).slice(0, 100)
    );
  }

  async function saveGradingRecord(record) {
    const row = normalizeGradingRecord(record);
    return withFallback(
      async () => {
        const db = await getPool();
        const conn = await db.getConnection();
        try {
          await conn.beginTransaction();
          await conn.execute(
            `INSERT INTO grading_submission
              (upload_no, paper_no, assignment_no, student_no, student_name, file_name, image_url, recognition_engine,
               recognized_json, grading_json, score, total_score, objective_score, objective_full_score,
               accuracy, manual_review_count, feedback, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
               paper_no = VALUES(paper_no), assignment_no = VALUES(assignment_no), student_no = VALUES(student_no),
               student_name = VALUES(student_name), file_name = VALUES(file_name), image_url = VALUES(image_url),
               recognition_engine = VALUES(recognition_engine), recognized_json = VALUES(recognized_json), grading_json = VALUES(grading_json),
               score = VALUES(score), total_score = VALUES(total_score), objective_score = VALUES(objective_score),
               objective_full_score = VALUES(objective_full_score), accuracy = VALUES(accuracy),
               manual_review_count = VALUES(manual_review_count), feedback = VALUES(feedback), status = VALUES(status), updated_at = CURRENT_TIMESTAMP`,
            [
              row.uploadId,
              row.paperId,
              row.assignmentId,
              row.studentId,
              row.studentName,
              row.fileName,
              row.imageUrl,
              row.recognized.engine,
              JSON.stringify(row.recognized),
              JSON.stringify(row.grading),
              row.grading.score,
              row.grading.totalScore,
              row.grading.objectiveScore,
              row.grading.objectiveFullScore,
              row.grading.accuracy,
              row.grading.manualReviewCount,
              row.feedback,
              row.status,
            ]
          );
          await conn.execute('DELETE FROM grading_question_result WHERE upload_no = ?', [row.uploadId]);
          for (const detail of row.grading.details || []) {
            await conn.execute(
              `INSERT INTO grading_question_result
                 (upload_no, question_no, question_id, question_type, result_kind, recognized_answer, correct_answer,
                  score, full_score, is_correct, status, result_json)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                row.uploadId,
                detail.questionNo || 0,
                detail.questionId || '',
                detail.type || '',
                detail.kind || '',
                detail.recognizedAnswer || '',
                detail.correctAnswer || '',
                Number(detail.score || 0),
                Number(detail.fullScore || 0),
                detail.correct === undefined ? null : detail.correct ? 1 : 0,
                detail.status || '',
                JSON.stringify(detail),
              ]
            );
          }
          await conn.commit();
          return row;
        } catch (error) {
          await conn.rollback();
          throw error;
        } finally {
          conn.release();
        }
      },
      async () => {
        const rows = await readJson(gradingFile);
        const next = [row, ...rows.filter((item) => item.uploadId !== row.uploadId)].slice(0, 1000);
        await writeJson(gradingFile, next);
        return row;
      }
    );
  }

  async function listGradingRecords(filters = {}) {
    return withFallback(
      async () => {
        const db = await getPool();
        const conditions = [];
        const values = [];
        if (filters.uploadId) {
          conditions.push('upload_no = ?');
          values.push(filters.uploadId);
        }
        if (filters.layoutId) {
          conditions.push('layout_no = ?');
          values.push(filters.layoutId);
        }
        if (filters.paperId) {
          conditions.push('paper_no = ?');
          values.push(filters.paperId);
        }
        if (filters.assignmentId) {
          conditions.push('assignment_no = ?');
          values.push(filters.assignmentId);
        }
        if (filters.studentId) {
          conditions.push('student_no = ?');
          values.push(filters.studentId);
        }
        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
        const [rows] = await db.query(
          `SELECT upload_no, paper_no, assignment_no, student_no, student_name, file_name, image_url,
                  recognition_engine, recognized_json, grading_json, feedback, status, created_at, updated_at
           FROM grading_submission ${where} ORDER BY created_at DESC LIMIT 100`,
          values
        );
        return rows.map((row) => ({
          uploadId: row.upload_no,
          paperId: row.paper_no || '',
          assignmentId: row.assignment_no || '',
          studentId: row.student_no || '',
          studentName: row.student_name || '',
          fileName: row.file_name || '',
          imageUrl: row.image_url || '',
          recognized: parseJson(row.recognized_json, { engine: row.recognition_engine || '', answers: {} }),
          grading: parseJson(row.grading_json, {}),
          feedback: row.feedback || '',
          status: row.status || 'graded',
          createdAt: dateValue(row.created_at),
          updatedAt: dateValue(row.updated_at),
        }));
      },
      async () => filterRows(await readJson(gradingFile), filters).slice(0, 100)
    );
  }

  return { listGradingRecords, listLayouts, saveGradingRecord, saveLayout };
}

function normalizeLayout(layout = {}, qrDataUrl = '') {
  return {
    layoutId: layout.layoutId,
    paperId: layout.paperId || '',
    studentId: layout.studentId || '',
    assignmentId: layout.assignmentId || '',
    templateVersion: layout.templateVersion || 'answer-sheet-v1',
    layout,
    qrPayload: layout.qr?.payload || {},
    qrDataUrl,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function normalizeGradingRecord(record = {}) {
  const grading = record.grading || {};
  return {
    uploadId: record.uploadId,
    fileName: record.fileName || '',
    imageUrl: record.imageUrl || '',
    storedFileName: record.storedFileName || '',
    studentId: record.studentId || '',
    studentName: record.studentName || '',
    assignmentId: record.assignmentId || '',
    paperId: record.paperId || '',
    answerSheetLayout: record.answerSheetLayout || null,
    recognized: record.recognized || { engine: '', answers: {} },
    grading: {
      objectiveScore: Number(grading.objectiveScore || 0),
      objectiveFullScore: Number(grading.objectiveFullScore || 0),
      subjectiveFullScore: Number(grading.subjectiveFullScore || 0),
      score: Number(grading.score || 0),
      totalScore: Number(grading.totalScore || 0),
      accuracy: Number(grading.accuracy || 0),
      wrong: Array.isArray(grading.wrong) ? grading.wrong : [],
      manualReviewCount: Number(grading.manualReviewCount || 0),
      details: Array.isArray(grading.details) ? grading.details : [],
    },
    feedback: record.feedback || '',
    status: record.status || 'graded',
    createdAt: record.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function filterRows(rows, filters = {}) {
  return rows.filter((row) =>
    (!filters.uploadId || row.uploadId === filters.uploadId) &&
    (!filters.layoutId || row.layoutId === filters.layoutId) &&
    (!filters.paperId || row.paperId === filters.paperId) &&
    (!filters.assignmentId || row.assignmentId === filters.assignmentId) &&
    (!filters.studentId || row.studentId === filters.studentId)
  );
}

function parseJson(value, fallback) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function dateValue(value) {
  return value instanceof Date ? value.toISOString() : value;
}

module.exports = { createGradingStore };
