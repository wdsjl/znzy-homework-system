const fs = require('fs/promises');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');

async function readJson(file, fallback) {
  try {
    const text = await fs.readFile(file, 'utf-8');
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

async function writeJson(file, rows) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(rows, null, 2), 'utf-8');
}

function filterQuestions(rows, query = {}) {
  const { type, subject, keyword, knowledge } = query;
  return rows.filter((q) =>
    (!type || type === '全部' || q.type === type) &&
    (!subject || subject === '全部' || q.subject === subject) &&
    (!knowledge || knowledge === '全部' || q.knowledge === knowledge) &&
    (!keyword || `${q.stem}${q.answer}${q.analysis}${q.knowledge}`.includes(keyword))
  );
}

function createJsonStore() {
  const questionsFile = path.join(dataDir, 'questions.json');
  const papersFile = path.join(dataDir, 'papers.json');
  const gradingsFile = path.join(dataDir, 'gradings.json');

  return {
    mode: 'json',
    async init() {},

    async listQuestions(query) {
      const rows = await readJson(questionsFile, []);
      return filterQuestions(rows, query);
    },

    async createQuestions(items) {
      const rows = await readJson(questionsFile, []);
      const next = [...items, ...rows];
      await writeJson(questionsFile, next);
      return items;
    },

    async updateQuestion(id, patch) {
      const rows = await readJson(questionsFile, []);
      const idx = rows.findIndex((q) => q.id === id);
      if (idx === -1) return null;
      rows[idx] = { ...rows[idx], ...patch, id };
      await writeJson(questionsFile, rows);
      return rows[idx];
    },

    async deleteQuestion(id) {
      const rows = await readJson(questionsFile, []);
      const next = rows.filter((q) => q.id !== id);
      await writeJson(questionsFile, next);
      return next.length;
    },

    async savePaper(paper) {
      const papers = await readJson(papersFile, []);
      papers.unshift(paper);
      await writeJson(papersFile, papers);
      return paper;
    },

    async getPaper(id) {
      const papers = await readJson(papersFile, []);
      return papers.find((p) => p.id === id) || null;
    },

    async saveGrading(grading) {
      const gradings = await readJson(gradingsFile, []);
      gradings.unshift(grading);
      await writeJson(gradingsFile, gradings);
      return grading;
    },

    async listGradings(query = {}) {
      const gradings = await readJson(gradingsFile, []);
      const { studentId, paperId } = query;
      return gradings.filter((g) =>
        (!studentId || g.studentId === studentId) &&
        (!paperId || g.paperId === paperId)
      );
    },

    async getGrading(id) {
      const gradings = await readJson(gradingsFile, []);
      return gradings.find((g) => g.id === id) || null;
    },

    async updateGrading(id, patch) {
      const gradings = await readJson(gradingsFile, []);
      const idx = gradings.findIndex((g) => g.id === id);
      if (idx === -1) return null;
      gradings[idx] = { ...gradings[idx], ...patch, id };
      await writeJson(gradingsFile, gradings);
      return gradings[idx];
    },
  };
}

module.exports = { createJsonStore, filterQuestions };
