#!/usr/bin/env node
/**
 * 异步批改 E2E：验证 memory / redis 队列与 HTTP 上传轮询链路
 *
 * 用法：
 *   node server/scripts/e2e-async-grading.cjs
 *   REDIS_URL=redis://127.0.0.1:6379 node server/scripts/e2e-async-grading.cjs --backend=redis
 *   API_BASE=http://127.0.0.1:4000/api node server/scripts/e2e-async-grading.cjs --http
 */
const fs = require('fs/promises');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const sharp = require('sharp');
const { initGradingQueue, getGradingQueue, resetGradingQueue } = require('../queue/index.cjs');
const { getStore } = require('../store/index.cjs');
const { buildAnswerSheetLayout } = require('../answerSheetLayout.cjs');

const args = process.argv.slice(2);
const wantHttp = args.includes('--http');
const backendArg = args.find((a) => a.startsWith('--backend='));
const forceBackend = backendArg ? backendArg.split('=')[1] : null;
const API_BASE = process.env.API_BASE || 'http://127.0.0.1:4000/api';

async function createSyntheticImage(outPath) {
  const w = 800;
  const h = 1100;
  const base = Buffer.alloc(w * h);
  base.fill(255);
  const drawSquare = (cx, cy, size) => {
    for (let y = cy; y < cy + size; y += 1) {
      for (let x = cx; x < cx + size; x += 1) {
        if (x >= 0 && x < w && y >= 0 && y < h) base[y * w + x] = 0;
      }
    }
  };
  drawSquare(40, 40, 50);
  drawSquare(w - 90, 40, 50);
  drawSquare(40, h - 90, 50);
  drawSquare(w - 90, h - 90, 50);
  await sharp(base, { raw: { width: w, height: h, channels: 1 } }).jpeg().toFile(outPath);
}

async function mockWorker(payload, onProgress) {
  onProgress?.('loading-paper', 20);
  const store = await getStore();
  const paper = await store.getPaper(payload.paperId);
  if (!paper) throw new Error('试卷不存在');
  onProgress?.('ocr-grading', 60);
  await new Promise((r) => setTimeout(r, 300));
  onProgress?.('saving', 90);
  return {
    id: `grading-${Date.now()}`,
    paperId: payload.paperId,
    studentId: payload.studentId,
    accuracy: 88,
    earnedScore: 22,
    totalScore: 25,
    mode: 'e2e-mock',
    wrongPoints: [],
    feedback: 'E2E 测试通过',
    gradedAt: new Date().toISOString(),
  };
}

async function seedPaper() {
  const store = await getStore();
  const questions = [
    {
      id: 'e2e-q1',
      section: '一、单选题',
      type: '单选题',
      stem: '1+1=?',
      options: ['1', '2', '3', '4'],
      answer: 'B',
      analysis: '',
      subject: '数学',
      knowledge: '基础运算',
      difficulty: '简单',
      score: 5,
      sortNo: 1,
    },
    {
      id: 'e2e-q2',
      section: '二、填空题',
      type: '填空题',
      stem: '2+3=?',
      options: [],
      answer: '5',
      analysis: '',
      subject: '数学',
      knowledge: '基础运算',
      difficulty: '简单',
      score: 5,
      sortNo: 2,
    },
  ];
  const paperId = `e2e-paper-${Date.now()}`;
  const paper = {
    id: paperId,
    title: 'E2E 异步批改测试卷',
    subject: '数学',
    studentId: 'e2e-student-001',
    assignmentId: 'e2e-assignment-001',
    totalScore: 10,
    templateVersion: '1.0',
    questions,
    createdAt: new Date().toISOString(),
    answerSheetLayout: buildAnswerSheetLayout({ paperId, questions }),
  };
  await store.savePaper(paper);
  return paper;
}

async function pollJob(queue, jobId, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const job = await queue.getJob(jobId);
    if (!job) throw new Error(`任务 ${jobId} 不存在`);
    if (job.status === 'completed') return job;
    if (job.status === 'failed') throw new Error(job.error || '批改失败');
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('轮询超时');
}

async function testQueueDirect(backend) {
  await resetGradingQueue();
  if (backend === 'redis' && !process.env.REDIS_URL) {
    process.env.REDIS_URL = 'redis://127.0.0.1:6379';
  }
  if (backend === 'memory') {
    delete process.env.REDIS_URL;
  }

  const paper = await seedPaper();
  const uploadsDir = path.join(__dirname, '..', 'uploads');
  await fs.mkdir(uploadsDir, { recursive: true });
  const imagePath = path.join(uploadsDir, `e2e-${Date.now()}.jpg`);
  await createSyntheticImage(imagePath);

  const worker = mockWorker;
  const queue = await initGradingQueue(worker);
  const payload = {
    paperId: paper.id,
    studentId: paper.studentId,
    assignmentId: paper.assignmentId,
    absoluteImagePath: imagePath,
    imagePath: `/uploads/${path.basename(imagePath)}`,
    imageName: path.basename(imagePath),
  };

  const job = await queue.enqueue(payload);
  console.log(`[queue] enqueued job ${job.id} backend=${queue.mode || backend}`);

  const done = await pollJob(getGradingQueue(), job.id);
  if (done.status !== 'completed' || !done.result?.id) {
    throw new Error('队列任务未成功完成');
  }
  console.log(`[queue] completed gradingId=${done.result.id} accuracy=${done.result.accuracy}`);
  await resetGradingQueue();
  return { backend: queue.mode || backend, jobId: job.id, gradingId: done.result.id };
}

function multipartUpload({ paperId, studentId, imagePath, apiBase }) {
  const boundary = `----e2e-${Date.now()}`;
  const imageBuf = require('fs').readFileSync(imagePath);
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="paperId"\r\n\r\n${paperId}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="studentId"\r\n\r\n${studentId}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="e2e.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
    imageBuf,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);

  return new Promise((resolve, reject) => {
    const url = new URL(`${apiBase}/grading/upload?async=1`);
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: 'POST',
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': body.length },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, json: JSON.parse(data) });
          } catch (err) {
            reject(err);
          }
        });
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function httpGetJson(urlPath) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath);
    http.get(url, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function waitForHealth(apiBase, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const health = await httpGetJson(`${apiBase}/health`);
      if (health.ok) return health;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('API 健康检查超时');
}

async function testHttp(apiBase, backend) {
  const env = {
    ...process.env,
    ASYNC_GRADING: '1',
    API_PORT: new URL(apiBase).port || '4000',
  };
  if (backend === 'redis') env.REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
  if (backend === 'memory') delete env.REDIS_URL;

  const server = spawn('node', ['server/index.cjs'], {
    cwd: path.join(__dirname, '..', '..'),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let serverLog = '';
  server.stdout.on('data', (d) => { serverLog += d; });
  server.stderr.on('data', (d) => { serverLog += d; });

  try {
    const health = await waitForHealth(apiBase);
    console.log(`[http] API ready storage=${health.storage} queue=${health.gradingQueue}`);

    const paper = await seedPaper();
    const uploadsDir = path.join(__dirname, '..', 'uploads');
    const imagePath = path.join(uploadsDir, `e2e-http-${Date.now()}.jpg`);
    await createSyntheticImage(imagePath);

    const uploadRes = await multipartUpload({
      paperId: paper.id,
      studentId: paper.studentId,
      imagePath,
      apiBase,
    });
    if (uploadRes.status !== 200) throw new Error(`上传失败: ${uploadRes.status} ${JSON.stringify(uploadRes.json)}`);

    const jobId = uploadRes.json?.data?.jobId;
    if (!jobId) throw new Error('未返回 jobId');
    console.log(`[http] async upload jobId=${jobId} backend=${uploadRes.json?.data?.backend}`);

    const start = Date.now();
    while (Date.now() - start < 45000) {
      const jobRes = await httpGetJson(`${apiBase}/grading/jobs/${jobId}`);
      const job = jobRes.data;
      if (job.status === 'completed' && job.result) {
        console.log(`[http] completed gradingId=${job.result.id || job.gradingId} mode=${job.result.mode}`);
        return { backend: health.gradingQueue, jobId, gradingId: job.result.id || job.gradingId };
      }
      if (job.status === 'failed') throw new Error(job.error || 'HTTP 批改失败');
      await new Promise((r) => setTimeout(r, 800));
    }
    throw new Error('HTTP 轮询超时');
  } finally {
    server.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 500));
    if (server.exitCode === null) server.kill('SIGKILL');
    if (serverLog.includes('Error')) {
      console.warn('[http] server log snippet:', serverLog.slice(-400));
    }
  }
}

async function main() {
  const backends = forceBackend ? [forceBackend] : ['memory', 'redis'];
  const results = [];

  for (const backend of backends) {
    console.log(`\n=== E2E queue direct (${backend}) ===`);
    try {
      if (backend === 'redis') {
        const Redis = require('ioredis');
        const client = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', { maxRetriesPerRequest: 1, lazyConnect: true });
        await client.connect();
        await client.ping();
        await client.quit();
      }
      const r = await testQueueDirect(backend);
      results.push({ scope: 'queue', backend, ok: true, ...r });
      console.log(`✓ queue/${backend} OK`);
    } catch (err) {
      if (backend === 'redis' && !forceBackend) {
        console.warn(`⚠ queue/redis 跳过: ${err.message}`);
        results.push({ scope: 'queue', backend, ok: false, skipped: true, error: err.message });
      } else {
        throw err;
      }
    }
  }

  if (wantHttp) {
    for (const backend of backends) {
      console.log(`\n=== E2E HTTP upload (${backend}) ===`);
      try {
        if (backend === 'redis') {
          const Redis = require('ioredis');
          const client = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', { maxRetriesPerRequest: 1, lazyConnect: true });
          await client.connect();
          await client.ping();
          await client.quit();
        }
        const r = await testHttp(API_BASE, backend);
        results.push({ scope: 'http', backend, ok: true, ...r });
        console.log(`✓ http/${backend} OK`);
      } catch (err) {
        if (backend === 'redis' && !forceBackend) {
          console.warn(`⚠ http/redis 跳过: ${err.message}`);
          results.push({ scope: 'http', backend, ok: false, skipped: true, error: err.message });
        } else {
          throw err;
        }
      }
    }
  }

  const failed = results.filter((r) => !r.ok && !r.skipped);
  console.log('\n--- E2E summary ---');
  console.log(JSON.stringify(results, null, 2));
  if (failed.length) {
    process.exit(1);
  }
  console.log('\nAll E2E checks passed.');
}

main().catch((err) => {
  console.error('E2E failed:', err);
  process.exit(1);
});
