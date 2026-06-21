const express = require('express');
const cors = require('cors');
const multer = require('multer');
const mammoth = require('mammoth');
const path = require('path');
const crypto = require('crypto');
const QRCode = require('qrcode');
const { buildAnswerSheetLayout, TEMPLATE_VERSION } = require('./answerSheetLayout.cjs');
const { buildGradingResultFromImage, applyManualReview } = require('./grading.cjs');
const { isLlmEnabled } = require('./ocr/llmGrader.cjs');
const { getStore } = require('./store/index.cjs');
const { initGradingQueue, getGradingQueue } = require('./queue/index.cjs');
const { buildStudentProfile } = require('./services/studentProfile.cjs');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const gradingUpload = multer({
  storage: multer.diskStorage({
    destination: async (_, __, cb) => {
      const dir = path.join(__dirname, 'uploads');
      const fs = require('fs/promises');
      await fs.mkdir(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_, file, cb) => {
      cb(null, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${path.extname(file.originalname || '.jpg')}`);
    },
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
});
const port = process.env.API_PORT || 4000;
let storageMode = 'json';
let queueMode = 'memory';

const corsOrigin = process.env.CORS_ORIGIN || '';
const corsOptions = corsOrigin
  ? { origin: corsOrigin.split(',').map((s) => s.trim()).filter(Boolean), credentials: true }
  : {};

app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/embed', express.static(path.join(__dirname, '..', 'public', 'embed')));

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

function withSortNo(questions) {
  return questions.map((q, idx) => ({ ...q, sortNo: idx + 1 }));
}

async function buildQrPayload({ paperId, studentId, assignmentId }) {
  return {
    paperId,
    studentId: studentId || '',
    assignmentId: assignmentId || '',
    templateVersion: TEMPLATE_VERSION,
  };
}

app.get('/api/health', async (_, res) => {
  res.json({
    ok: true,
    service: 'znzy-question-api',
    templateVersion: TEMPLATE_VERSION,
    storage: storageMode,
    ocr: 'contour-perspective+tesseract+bubble-detect',
    llm: isLlmEnabled(),
    formalSchema: process.env.USE_FORMAL_SCHEMA === '1',
    asyncGrading: process.env.ASYNC_GRADING === '1',
    gradingQueue: queueMode,
    publicOrigin: process.env.PUBLIC_ORIGIN || null,
    features: ['contour-marker', 'marker-perspective', 'subjective-ai-fuzzy', 'llm-semantic', 'manual-review', 'formal-schema', 'async-grading', 'student-profile', 'redis-queue', 'host-embed-sdk'],
  });
});

async function runGradingJob(payload, onProgress) {
  const store = await getStore();
  onProgress?.('loading-paper', 20);
  const paper = await store.getPaper(payload.paperId);
  if (!paper) throw new Error('试卷不存在');
  onProgress?.('ocr-grading', 45);
  const layout = paper.answerSheetLayout || buildAnswerSheetLayout({ paperId: paper.id, questions: paper.questions || [] });
  const result = await buildGradingResultFromImage({
    paper: { ...paper, assignmentId: payload.assignmentId || paper.assignmentId },
    studentId: payload.studentId,
    absoluteImagePath: payload.absoluteImagePath,
    imagePath: payload.imagePath,
    imageName: payload.imageName,
    layout,
  });
  onProgress?.('saving', 90);
  await store.saveGrading(result);
  return result;
}

app.get('/api/questions', async (req, res) => {
  const store = await getStore();
  const filtered = await store.listQuestions(req.query);
  res.json({ data: filtered, total: filtered.length, storage: store.mode });
});

app.get('/api/knowledge-points', async (_, res) => {
  const store = await getStore();
  const rows = await store.listQuestions({});
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
  const store = await getStore();
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
  await store.createQuestions(saved);
  const total = (await store.listQuestions({})).length;
  res.json({ data: saved, total, storage: store.mode });
});

app.put('/api/questions/:id', async (req, res) => {
  const store = await getStore();
  const updated = await store.updateQuestion(req.params.id, { ...req.body, updatedAt: new Date().toISOString().slice(0, 10) });
  if (!updated) return res.status(404).json({ message: '题目不存在' });
  res.json({ data: updated, storage: store.mode });
});

app.delete('/api/questions/:id', async (req, res) => {
  const store = await getStore();
  const total = await store.deleteQuestion(req.params.id);
  res.json({ ok: true, total, storage: store.mode });
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
  const store = await getStore();
  const rows = await store.listQuestions({});
  const { subject, type, count = 5, knowledge, studentId, assignmentId, title } = req.body || {};
  const pool = rows.filter((q) =>
    (!subject || q.subject === subject) &&
    (!type || q.type === type) &&
    (!knowledge || q.knowledge.includes(knowledge))
  );
  const questions = withSortNo(pool.slice(0, Number(count)));
  const paperId = crypto.randomUUID();
  const paper = {
    id: paperId,
    title: title || `${subject || '理科'}智能组卷`,
    subject: subject || '理科',
    studentId: studentId || null,
    assignmentId: assignmentId || null,
    totalScore: questions.reduce((sum, q) => sum + Number(q.score || 0), 0),
    templateVersion: TEMPLATE_VERSION,
    questions,
    createdAt: new Date().toISOString(),
  };
  paper.answerSheetLayout = buildAnswerSheetLayout({ paperId, questions });
  await store.savePaper(paper);
  const qrPayload = await buildQrPayload({ paperId, studentId, assignmentId });
  const qrDataUrl = await QRCode.toDataURL(JSON.stringify(qrPayload), { margin: 1, width: 220 });
  res.json({ data: { ...paper, qrPayload, qrDataUrl }, storage: store.mode });
});

app.get('/api/papers/:id', async (req, res) => {
  const store = await getStore();
  const paper = await store.getPaper(req.params.id);
  if (!paper) return res.status(404).json({ message: '试卷不存在' });
  res.json({ data: paper, storage: store.mode });
});

app.get('/api/papers/:id/answer-sheet-layout', async (req, res) => {
  const store = await getStore();
  const paper = await store.getPaper(req.params.id);
  if (!paper) return res.status(404).json({ message: '试卷不存在' });
  const layout = paper.answerSheetLayout || buildAnswerSheetLayout({ paperId: paper.id, questions: paper.questions || [] });
  res.json({ data: layout, storage: store.mode });
});

app.get('/api/papers/:id/qr', async (req, res) => {
  const store = await getStore();
  const paper = await store.getPaper(req.params.id);
  if (!paper) return res.status(404).json({ message: '试卷不存在' });
  const { studentId, assignmentId } = req.query;
  const qrPayload = await buildQrPayload({
    paperId: paper.id,
    studentId: studentId || paper.studentId,
    assignmentId: assignmentId || paper.assignmentId,
  });
  const qrDataUrl = await QRCode.toDataURL(JSON.stringify(qrPayload), { margin: 1, width: 220 });
  res.json({ data: { qrPayload, qrDataUrl } });
});

app.post('/api/grading/upload', gradingUpload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: '缺少答题卡图片' });
  const { paperId, studentId, assignmentId } = req.body || {};
  if (!paperId) return res.status(400).json({ message: '缺少 paperId' });

  const store = await getStore();
  const paper = await store.getPaper(paperId);
  if (!paper) return res.status(404).json({ message: '试卷不存在' });

  const absoluteImagePath = path.join(__dirname, 'uploads', req.file.filename);
  const payload = {
    paperId,
    studentId,
    assignmentId: assignmentId || paper.assignmentId,
    absoluteImagePath,
    imagePath: `/uploads/${req.file.filename}`,
    imageName: req.file.originalname,
  };

  const useAsync = req.query.async === '1' || process.env.ASYNC_GRADING === '1';
  if (useAsync) {
    const queue = getGradingQueue();
    const job = await queue.enqueue(payload);
    return res.json({ data: { jobId: job.id, status: job.status, async: true, backend: job.backend || queueMode }, storage: store.mode });
  }

  const result = await runGradingJob(payload);
  res.json({ data: result, storage: store.mode });
});

app.get('/api/grading/jobs', async (req, res) => {
  const queue = getGradingQueue();
  const jobs = await queue.listJobs(req.query);
  res.json({ data: jobs, total: jobs.length, backend: queue.mode || queueMode });
});

app.get('/api/grading/jobs/:jobId', async (req, res) => {
  const queue = getGradingQueue();
  const job = await queue.getJob(req.params.jobId);
  if (!job) return res.status(404).json({ message: '批改任务不存在' });
  res.json({ data: job });
});

app.get('/api/students/:studentId/profile', async (req, res) => {
  const store = await getStore();
  const profile = await buildStudentProfile(store, req.params.studentId, {
    studentName: req.query.studentName,
  });
  res.json({ data: profile, storage: store.mode });
});

app.get('/api/grading', async (req, res) => {
  const store = await getStore();
  const filtered = await store.listGradings(req.query);
  res.json({ data: filtered, total: filtered.length, storage: store.mode });
});

app.get('/api/grading/:id', async (req, res) => {
  const store = await getStore();
  const grading = await store.getGrading(req.params.id);
  if (!grading) return res.status(404).json({ message: '批改记录不存在' });
  res.json({ data: grading, storage: store.mode });
});

app.post('/api/grading/:id/review', async (req, res) => {
  const store = await getStore();
  const grading = await store.getGrading(req.params.id);
  if (!grading) return res.status(404).json({ message: '批改记录不存在' });
  const reviewed = applyManualReview(grading, req.body || {});
  await store.updateGrading(req.params.id, reviewed);
  res.json({ data: reviewed, storage: store.mode });
});

if (process.env.SERVE_STATIC === '1') {
  const distPath = path.join(__dirname, '..', 'dist');
  app.use(express.static(distPath));
  app.get(/^(?!\/api|\/uploads|\/embed).*/, (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const indexFile = path.join(distPath, 'index.html');
    res.sendFile(indexFile, (err) => {
      if (err) next(err);
    });
  });
}

async function start() {
  const queue = await initGradingQueue(runGradingJob);
  queueMode = queue.mode || (process.env.REDIS_URL ? 'redis' : 'memory');
  const store = await getStore();
  storageMode = store.mode;
  app.listen(port, () => {
    const mode = process.env.SERVE_STATIC === '1' ? 'h5+api' : 'api';
    console.log(`Question API running at http://localhost:${port} [mode=${mode}, storage=${storageMode}, queue=${queueMode}]`);
  });
}

start();
