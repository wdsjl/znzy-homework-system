const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const jobsFile = path.join(__dirname, '..', 'data', 'grading-jobs.json');
const jobs = new Map();
const queue = [];
let processing = false;
let boundWorker = null;

async function loadJobs() {
  try {
    const text = await fs.readFile(jobsFile, 'utf-8');
    const rows = JSON.parse(text);
    for (const job of rows) jobs.set(job.id, job);
  } catch {
    /* empty */
  }
}

async function persistJobs() {
  await fs.mkdir(path.dirname(jobsFile), { recursive: true });
  const rows = [...jobs.values()].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 200);
  await fs.writeFile(jobsFile, JSON.stringify(rows, null, 2), 'utf-8');
}

function bindWorker(worker) {
  boundWorker = worker;
}

function createJob(payload) {
  const job = {
    id: crypto.randomUUID(),
    status: 'queued',
    progress: 0,
    stage: 'queued',
    backend: 'memory',
    createdAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
    error: null,
    payload,
    result: null,
    gradingId: null,
  };
  jobs.set(job.id, job);
  queue.push(job.id);
  return job;
}

function getJob(id) {
  return jobs.get(id) || null;
}

function listJobs(filter = {}) {
  let rows = [...jobs.values()];
  if (filter.studentId) rows = rows.filter((j) => j.payload?.studentId === filter.studentId);
  if (filter.paperId) rows = rows.filter((j) => j.payload?.paperId === filter.paperId);
  if (filter.status) rows = rows.filter((j) => j.status === filter.status);
  return rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

function updateJob(id, patch) {
  const job = jobs.get(id);
  if (!job) return null;
  Object.assign(job, patch);
  jobs.set(id, job);
  return job;
}

async function processQueue() {
  if (processing || !boundWorker) return;
  processing = true;
  try {
    while (queue.length) {
      const jobId = queue.shift();
      const job = jobs.get(jobId);
      if (!job || job.status !== 'queued') continue;

      updateJob(jobId, { status: 'processing', stage: 'preprocessing', progress: 10, startedAt: new Date().toISOString() });
      await persistJobs();

      try {
        const onProgress = (stage, progress) => updateJob(jobId, { stage, progress });
        const result = await boundWorker(job.payload, onProgress);
        updateJob(jobId, {
          status: 'completed',
          stage: 'done',
          progress: 100,
          finishedAt: new Date().toISOString(),
          result,
          gradingId: result?.id || null,
        });
      } catch (err) {
        updateJob(jobId, {
          status: 'failed',
          stage: 'error',
          progress: 100,
          finishedAt: new Date().toISOString(),
          error: err.message || String(err),
        });
      }
      await persistJobs();
    }
  } finally {
    processing = false;
  }
}

function enqueue(payload) {
  const job = createJob(payload);
  persistJobs().catch(() => undefined);
  processQueue().catch(() => undefined);
  return job;
}

module.exports = {
  mode: 'memory',
  loadJobs,
  bindWorker,
  createJob,
  getJob,
  listJobs,
  updateJob,
  enqueue,
};
