const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const mysql = require('mysql2/promise');

function createQuestionStore({ dataFile }) {
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
        console.warn(`[question-store] mysql unavailable, falling back to JSON: ${error.message}`);
      }
    }
    return fallback();
  }

  async function readJson() {
    try {
      const text = await fs.readFile(dataFile, 'utf-8');
      const rows = JSON.parse(text);
      return Array.isArray(rows) ? rows.map(normalizeQuestion) : [];
    } catch {
      return [];
    }
  }

  async function writeJson(rows) {
    await fs.mkdir(path.dirname(dataFile), { recursive: true });
    await fs.writeFile(dataFile, JSON.stringify(rows, null, 2), 'utf-8');
  }

  async function readMysql() {
    const db = await getPool();
    const [rows] = await db.query(`
      SELECT
        q.id AS dbId,
        q.question_no AS id,
        q.section_title AS section,
        q.question_type AS type,
        q.stem,
        q.answer,
        q.analysis,
        q.subject,
        COALESCE(GROUP_CONCAT(DISTINCT kp.name ORDER BY kp.name SEPARATOR '、'), '待绑定') AS knowledge,
        q.difficulty,
        q.score,
        q.source,
        q.status,
        DATE_FORMAT(q.created_at, '%Y-%m-%d') AS createdAt
      FROM question q
      LEFT JOIN question_knowledge_relation qkr ON qkr.question_id = q.id
      LEFT JOIN knowledge_point kp ON kp.id = qkr.knowledge_id
      GROUP BY q.id
      ORDER BY q.created_at DESC, q.id DESC
    `);
    const ids = rows.map((row) => row.dbId);
    const optionsByQuestion = new Map();
    if (ids.length) {
      const [options] = await db.query(
        'SELECT question_id, option_key, option_content FROM question_option WHERE question_id IN (?) ORDER BY sort_no ASC, option_key ASC',
        [ids]
      );
      for (const option of options) {
        const list = optionsByQuestion.get(option.question_id) || [];
        list.push(option.option_content || '');
        optionsByQuestion.set(option.question_id, list);
      }
    }
    return rows.map((row) => normalizeQuestion({ ...row, options: optionsByQuestion.get(row.dbId) || [] }));
  }

  async function listQuestions(filters = {}) {
    const rows = await withFallback(readMysql, readJson);
    return applyFilters(rows, filters);
  }

  async function createQuestions(items = []) {
    const rows = (Array.isArray(items) ? items : [items]).map(normalizeQuestion);
    return withFallback(
      async () => {
        const db = await getPool();
        const conn = await db.getConnection();
        try {
          await conn.beginTransaction();
          for (const row of rows) {
            const [result] = await conn.execute(
              `INSERT INTO question
                (question_no, section_title, question_type, subject, difficulty, score, stem, answer, analysis, source, status, duplicate_hash)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                row.id,
                row.section,
                row.type,
                row.subject,
                row.difficulty,
                row.score,
                row.stem,
                row.answer,
                row.analysis,
                row.source,
                row.status,
                hashQuestion(row),
              ]
            );
            await replaceOptions(conn, result.insertId, row.options, row.answer);
            await replaceKnowledge(conn, result.insertId, row.subject, row.knowledge);
          }
          await conn.commit();
        } catch (error) {
          await conn.rollback();
          throw error;
        } finally {
          conn.release();
        }
        return rows;
      },
      async () => {
        const existing = await readJson();
        await writeJson([...rows, ...existing]);
        return rows;
      }
    );
  }

  async function updateQuestion(id, patch) {
    return withFallback(
      async () => {
        const db = await getPool();
        const conn = await db.getConnection();
        try {
          await conn.beginTransaction();
          const [found] = await conn.execute(
            'SELECT id FROM question WHERE question_no = ? OR CAST(id AS CHAR) = ? LIMIT 1',
            [id, id]
          );
          if (!found.length) return null;
          const questionId = found[0].id;
          const current = (await readMysql()).find((question) => question.id === id || String(question.dbId) === id) || {};
          const row = normalizeQuestion({ ...current, ...patch, id });
          await conn.execute(
            `UPDATE question
             SET section_title = ?, question_type = ?, subject = ?, difficulty = ?, score = ?, stem = ?,
                 answer = ?, analysis = ?, source = ?, status = ?, duplicate_hash = ?
             WHERE id = ?`,
            [
              row.section,
              row.type,
              row.subject,
              row.difficulty,
              row.score,
              row.stem,
              row.answer,
              row.analysis,
              row.source,
              row.status,
              hashQuestion(row),
              questionId,
            ]
          );
          await replaceOptions(conn, questionId, row.options, row.answer);
          await replaceKnowledge(conn, questionId, row.subject, row.knowledge);
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
        const rows = await readJson();
        const index = rows.findIndex((question) => question.id === id);
        if (index === -1) return null;
        rows[index] = normalizeQuestion({ ...rows[index], ...patch, id, updatedAt: new Date().toISOString().slice(0, 10) });
        await writeJson(rows);
        return rows[index];
      }
    );
  }

  async function deleteQuestion(id) {
    return withFallback(
      async () => {
        const db = await getPool();
        const [result] = await db.execute(
          'DELETE FROM question WHERE question_no = ? OR CAST(id AS CHAR) = ?',
          [id, id]
        );
        return result.affectedRows > 0;
      },
      async () => {
        const rows = await readJson();
        const next = rows.filter((question) => question.id !== id);
        await writeJson(next);
        return next.length !== rows.length;
      }
    );
  }

  return {
    createQuestions,
    deleteQuestion,
    listQuestions,
    mode: () => (mysqlConfigured() ? 'mysql-with-json-fallback' : 'json'),
    updateQuestion,
  };
}

function normalizeQuestion(item = {}) {
  const id = String(item.id || item.questionNo || item.question_no || crypto.randomUUID());
  const type = item.type || item.questionType || item.question_type || '单选题';
  return {
    id,
    section: item.section || item.sectionTitle || item.section_title || `手动录入｜${type}`,
    type,
    stem: item.stem || '',
    options: Array.isArray(item.options) ? item.options.filter((option) => option !== undefined && option !== null) : [],
    answer: item.answer || item.ans || '',
    analysis: item.analysis || '',
    subject: item.subject || '数学',
    knowledge: item.knowledge || '待绑定',
    difficulty: item.difficulty || '中等',
    score: Number(item.score || 5),
    source: item.source || '接口入库',
    status: item.status || '已入库',
    createdAt: item.createdAt || item.created_at || new Date().toISOString().slice(0, 10),
  };
}

function applyFilters(rows, filters = {}) {
  const { type, subject, keyword, knowledge } = filters;
  return rows.filter((question) =>
    (!type || type === '全部' || question.type === type) &&
    (!subject || subject === '全部' || question.subject === subject) &&
    (!knowledge || knowledge === '全部' || question.knowledge === knowledge || question.knowledge.includes(knowledge)) &&
    (!keyword || `${question.stem}${question.answer}${question.analysis}${question.knowledge}`.includes(keyword))
  );
}

function hashQuestion(row) {
  return crypto.createHash('sha256').update(`${row.subject}|${row.type}|${row.stem}|${row.answer}`).digest('hex');
}

async function replaceOptions(conn, questionId, options = [], answer = '') {
  await conn.execute('DELETE FROM question_option WHERE question_id = ?', [questionId]);
  const normalizedAnswer = String(answer || '').toUpperCase();
  for (const [index, content] of options.entries()) {
    const key = String.fromCharCode(65 + index);
    await conn.execute(
      `INSERT INTO question_option (question_id, option_key, option_content, is_correct, sort_no)
       VALUES (?, ?, ?, ?, ?)`,
      [questionId, key, content, normalizedAnswer.includes(key) ? 1 : 0, index]
    );
  }
}

async function replaceKnowledge(conn, questionId, subject, knowledge) {
  await conn.execute('DELETE FROM question_knowledge_relation WHERE question_id = ?', [questionId]);
  const names = String(knowledge || '')
    .split(/[、,，|/]/)
    .map((name) => name.trim())
    .filter(Boolean);
  for (const name of names) {
    const [found] = await conn.execute(
      'SELECT id FROM knowledge_point WHERE subject = ? AND name = ? LIMIT 1',
      [subject, name]
    );
    let knowledgeId = found[0]?.id;
    if (!knowledgeId) {
      const [result] = await conn.execute(
        'INSERT INTO knowledge_point (subject, name, path, level_no, status) VALUES (?, ?, ?, 1, 1)',
        [subject, name, `${subject}/${name}`]
      );
      knowledgeId = result.insertId;
    }
    await conn.execute(
      'INSERT IGNORE INTO question_knowledge_relation (question_id, knowledge_id, weight) VALUES (?, ?, 1)',
      [questionId, knowledgeId]
    );
  }
}

module.exports = { createQuestionStore, normalizeQuestion };
