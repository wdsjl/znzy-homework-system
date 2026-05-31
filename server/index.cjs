const express = require('express');
const cors = require('cors');
const multer = require('multer');
const mammoth = require('mammoth');
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const {
  buildAnswerSheetLayout,
  buildQrPayload,
  createQrDataUrl,
  gradeObjectiveAnswers,
  mockRecognizeAnswers,
} = require('./answer-sheet.cjs');
const { createQuestionStore } = require('./question-store.cjs');
const { createGradingStore } = require('./grading-store.cjs');
const { buildStudentProfile } = require('./student-profile.cjs');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const dataFile = path.join(__dirname, 'data', 'questions.json');
const uploadDir = path.join(__dirname, 'uploads', 'grading');
const port = process.env.API_PORT || 4000;
const questionStore = createQuestionStore({ dataFile });
const gradingStore = createGradingStore({ dataDir: path.join(__dirname, 'data') });

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

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

function safeJson(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function sanitizeFileName(name = 'answer-sheet.jpg') {
  return String(name).replace(/[^\w.-]+/g, '_').slice(-120) || 'answer-sheet.jpg';
}

function normalizeQuestionForGrading(question, index) {
  return {
    id: question.id ?? index + 1,
    type: question.type || question.questionType || '解答题',
    stem: question.stem || '',
    answer: question.answer ?? question.ans ?? question.correctAnswer ?? '',
    score: Number(question.score || question.points || 0),
  };
}

app.get('/api/health', (_, res) => res.json({ ok: true, service: 'znzy-question-api', storage: questionStore.mode() }));

app.get('/api/questions', async (req, res) => {
  const filtered = await questionStore.listQuestions(req.query);
  res.json({ data: filtered, total: filtered.length });
});

app.get('/api/knowledge-points', async (_, res) => {
  const rows = await questionStore.listQuestions();
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
  const rows = await questionStore.createQuestions(saved);
  const total = (await questionStore.listQuestions()).length;
  res.json({ data: rows, total });
});

app.put('/api/questions/:id', async (req, res) => {
  const row = await questionStore.updateQuestion(req.params.id, req.body);
  if (!row) return res.status(404).json({ message: '题目不存在' });
  res.json({ data: row });
});

app.delete('/api/questions/:id', async (req, res) => {
  await questionStore.deleteQuestion(req.params.id);
  const next = await questionStore.listQuestions();
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
  const rows = await questionStore.listQuestions();
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

app.post('/api/answer-sheets/qrcode', async (req, res) => {
  const payload = buildQrPayload(req.body || {});
  const qrDataUrl = await createQrDataUrl(payload);
  res.json({ data: { payload, qrDataUrl } });
});

app.post('/api/answer-sheets/layout', async (req, res) => {
  const layout = buildAnswerSheetLayout(req.body || {});
  const qrDataUrl = await createQrDataUrl(layout.qr.payload);
  const saved = await gradingStore.saveLayout(layout, qrDataUrl);
  res.json({ data: { layout, qrPayload: layout.qr.payload, qrDataUrl, saved } });
});

app.get('/api/answer-sheets/layouts', async (req, res) => {
  const rows = await gradingStore.listLayouts(req.query);
  res.json({ data: rows, total: rows.length });
});

app.get('/api/answer-sheets/layouts/:layoutId', async (req, res) => {
  const rows = await gradingStore.listLayouts({ ...req.query, layoutId: req.params.layoutId });
  const row = rows.find((item) => item.layoutId === req.params.layoutId);
  if (!row) return res.status(404).json({ message: '答题卡布局不存在' });
  res.json({ data: row });
});

app.post('/api/grading/uploads', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: '缺少答题卡图片' });

  await fs.mkdir(uploadDir, { recursive: true });
  const uploadId = crypto.randomUUID();
  const ext = path.extname(req.file.originalname || '') || '.jpg';
  const storedName = `${uploadId}${ext}`;
  const storedPath = path.join(uploadDir, storedName);
  await fs.writeFile(storedPath, req.file.buffer);

  const questions = safeJson(req.body.questions, []).map(normalizeQuestionForGrading);
  const answerSheetLayout = safeJson(req.body.answerSheetLayout || req.body.layoutJson, null);
  const providedAnswers = safeJson(req.body.recognizedAnswers, null);
  const recognizedAnswers = providedAnswers || mockRecognizeAnswers(questions, `${uploadId}:${sanitizeFileName(req.file.originalname)}`);
  const grading = gradeObjectiveAnswers(questions, recognizedAnswers);
  const totalScore = questions.reduce((sum, question) => sum + Number(question.score || question.points || 0), 0);
  const score = grading.objectiveScore;
  const accuracy = grading.objectiveFullScore
    ? Math.round((grading.objectiveScore / grading.objectiveFullScore) * 100)
    : 0;
  const wrong = grading.details
    .filter((item) => item.kind === 'objective' && !item.correct)
    .map((item) => `${item.questionNo}题`);

  const record = {
    uploadId,
    fileName: req.file.originalname,
    imageUrl: `/uploads/grading/${storedName}`,
    storedFileName: storedName,
    studentId: req.body.studentId || '',
    studentName: req.body.studentName || '',
    assignmentId: req.body.assignmentId || '',
    paperId: req.body.paperId || '',
    answerSheetLayout,
    recognized: {
      engine: providedAnswers ? 'provided-json' : 'mock-bubble-recognition',
      answers: recognizedAnswers,
    },
    grading: {
      ...grading,
      score,
      totalScore,
      accuracy,
      wrong,
      manualReviewCount: grading.details.filter((item) => item.status === 'needs_manual_review').length,
    },
    feedback: wrong.length
      ? `客观题已自动判分，需重点复查：${wrong.join('、')}。主观题进入人工/AI 复核队列。`
      : '客观题全部正确，主观题进入人工/AI 复核队列。',
    createdAt: new Date().toISOString(),
  };
  const saved = await gradingStore.saveGradingRecord(record);
  res.json({ data: { ...record, saved: { uploadId: saved.uploadId, status: saved.status } } });
});


app.get('/api/students/:studentId/profile', async (req, res) => {
  const records = await gradingStore.listGradingRecords({ studentId: req.params.studentId, assignmentId: req.query.assignmentId });
  const profile = buildStudentProfile({
    studentId: req.params.studentId,
    studentName: req.query.studentName || '',
    records,
  });
  res.json({ data: profile });
});

app.get('/api/student-profile', async (req, res) => {
  const studentId = req.query.studentId || '';
  const records = await gradingStore.listGradingRecords({ studentId, assignmentId: req.query.assignmentId });
  const profile = buildStudentProfile({
    studentId,
    studentName: req.query.studentName || '',
    records,
  });
  res.json({ data: profile });
});

app.get('/api/grading/records', async (req, res) => {
  const rows = await gradingStore.listGradingRecords(req.query);
  res.json({ data: rows, total: rows.length });
});


app.patch('/api/grading/records/:uploadId/review', async (req, res) => {
  const row = await gradingStore.reviewGradingRecord(req.params.uploadId, req.body || {});
  if (!row) return res.status(404).json({ message: '批改记录不存在' });
  res.json({ data: row });
});

app.get('/api/grading/records/:uploadId', async (req, res) => {
  const rows = await gradingStore.listGradingRecords({ ...req.query, uploadId: req.params.uploadId });
  const row = rows.find((item) => item.uploadId === req.params.uploadId);
  if (!row) return res.status(404).json({ message: '批改记录不存在' });
  res.json({ data: row });
});

app.listen(port, () => {
  console.log(`Question API running at http://localhost:${port}`);
});
