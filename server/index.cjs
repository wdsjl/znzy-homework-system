const express = require('express');
const cors = require('cors');
const multer = require('multer');
const mammoth = require('mammoth');
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const dataFile = path.join(__dirname, 'data', 'questions.json');
const port = process.env.API_PORT || 4000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

async function readQuestions() {
  try {
    const text = await fs.readFile(dataFile, 'utf-8');
    return JSON.parse(text);
  } catch {
    return [];
  }
}

async function writeQuestions(rows) {
  await fs.mkdir(path.dirname(dataFile), { recursive: true });
  await fs.writeFile(dataFile, JSON.stringify(rows, null, 2), 'utf-8');
}

function parseQuestions(text) {
  const sections = String(text || '').split(/(?=^[一二三四五六七八九十]+、)/m);
  const result = [];
  for (const sec of sections) {
    const title = (sec.match(/^([一二三四五六七八九十]+、[^\n]+)/m)?.[1] || '未分类题型').trim();
    const type = title.replace(/^[一二三四五六七八九十]+、/, '');
    for (const block of sec.split('【结束】')) {
      if (!block.includes('【题文】')) continue;
      const pick = (a, b) => ((block.split(a)[1] || '').split(b)[0] || '').trim();
      const stem = pick('【题文】', '【选项A】') || pick('【题文】', '【答案】');
      const options = ['A', 'B', 'C', 'D'].map((key) => {
        const next = key === 'D' ? '【答案】' : `【选项${String.fromCharCode(key.charCodeAt(0) + 1)}】`;
        return pick(`【选项${key}】`, next);
      }).filter(Boolean);
      result.push({
        id: crypto.randomUUID(),
        section: title,
        type,
        stem,
        options,
        answer: pick('【答案】', '【解析】'),
        analysis: (block.split('【解析】')[1] || '').trim(),
        subject: '数学',
        knowledge: '待识别知识点',
        difficulty: '中等',
        score: type.includes('解答') ? 12 : type.includes('多选') ? 8 : 5,
        source: '服务端导入解析',
        status: '待确认',
        createdAt: new Date().toISOString().slice(0, 10),
      });
    }
  }
  return result;
}

app.get('/api/health', (_, res) => res.json({ ok: true, service: 'znzy-question-api' }));

app.get('/api/questions', async (req, res) => {
  const rows = await readQuestions();
  const { type, subject, keyword, knowledge } = req.query;
  const filtered = rows.filter((q) =>
    (!type || type === '全部' || q.type === type) &&
    (!subject || subject === '全部' || q.subject === subject) &&
    (!knowledge || knowledge === '全部' || q.knowledge === knowledge) &&
    (!keyword || `${q.stem}${q.answer}${q.analysis}${q.knowledge}`.includes(keyword))
  );
  res.json({ data: filtered, total: filtered.length });
});

app.get('/api/knowledge-points', async (_, res) => {
  const rows = await readQuestions();
  const map = new Map();
  for (const q of rows) {
    const subject = q.subject || '未分类';
    const knowledge = q.knowledge || '待绑定';
    if (!map.has(subject)) map.set(subject, new Set());
    map.get(subject).add(knowledge);
  }
  res.json({ data: Array.from(map.entries()).map(([subject, set]) => ({ subject, children: Array.from(set).map((name) => ({ name })) })) });
});

app.post('/api/questions', async (req, res) => {
  const rows = await readQuestions();
  const body = Array.isArray(req.body) ? req.body : [req.body];
  const saved = body.map((item) => ({
    id: item.id || crypto.randomUUID(),
    section: item.section || `手动录入｜${item.type || '未分类'}`,
    type: item.type || '单选题',
    stem: item.stem || '',
    options: item.options || [],
    answer: item.answer || '',
    analysis: item.analysis || '',
    subject: item.subject || '数学',
    knowledge: item.knowledge || '待绑定',
    difficulty: item.difficulty || '中等',
    score: Number(item.score || 5),
    source: item.source || '接口入库',
    status: '已入库',
    createdAt: item.createdAt || new Date().toISOString().slice(0, 10),
  }));
  await writeQuestions([...saved, ...rows]);
  res.json({ data: saved, total: rows.length + saved.length });
});

app.put('/api/questions/:id', async (req, res) => {
  const rows = await readQuestions();
  const idx = rows.findIndex((q) => q.id === req.params.id);
  if (idx === -1) return res.status(404).json({ message: '题目不存在' });
  rows[idx] = { ...rows[idx], ...req.body, id: req.params.id, updatedAt: new Date().toISOString().slice(0, 10) };
  await writeQuestions(rows);
  res.json({ data: rows[idx] });
});

app.delete('/api/questions/:id', async (req, res) => {
  const rows = await readQuestions();
  const next = rows.filter((q) => q.id !== req.params.id);
  await writeQuestions(next);
  res.json({ ok: true, total: next.length });
});

app.post('/api/question-import/paste', (req, res) => {
  const parsed = parseQuestions(req.body?.text || '');
  res.json({ data: parsed, count: parsed.length });
});

app.post('/api/question-import/docx', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: '缺少文件' });
  const result = await mammoth.extractRawText({ buffer: req.file.buffer });
  const parsed = parseQuestions(result.value);
  res.json({ data: parsed, count: parsed.length, rawText: result.value, fileName: req.file.originalname });
});

app.post('/api/papers/generate', async (req, res) => {
  const rows = await readQuestions();
  const { subject, type, count = 5, knowledge } = req.body || {};
  const pool = rows.filter((q) =>
    (!subject || q.subject === subject) &&
    (!type || q.type === type) &&
    (!knowledge || q.knowledge.includes(knowledge))
  );
  const questions = pool.slice(0, Number(count));
  res.json({
    data: {
      id: crypto.randomUUID(),
      title: `${subject || '理科'}智能组卷`,
      totalScore: questions.reduce((sum, q) => sum + Number(q.score || 0), 0),
      questions,
    },
  });
});

app.listen(port, () => {
  console.log(`Question API running at http://localhost:${port}`);
});
