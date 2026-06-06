const crypto = require('crypto');
const { Queue, Worker } = require('bullmq');

const QUEUE_NAME = 'znzy-grading';

function parseRedisUrl(url) {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    password: parsed.password || undefined,
    maxRetriesPerRequest: null,
  };
}

function mapBullJob(job, state) {
  if (!job) return null;
  const progress = typeof job.progress === 'object'
    ? job.progress
    : { stage: 'processing', progress: Number(job.progress || 0) };
  const statusMap = {
    completed: 'completed',
    failed: 'failed',
    active: 'processing',
    waiting: 'queued',
    delayed: 'queued',
    paused: 'queued',
    'waiting-children': 'queued',
  };
  return {
    id: job.id,
    status: statusMap[state] || 'queued',
    progress: progress.progress || 0,
    stage: progress.stage || (state === 'active' ? 'processing' : 'queued'),
    backend: 'redis',
    createdAt: job.timestamp ? new Date(job.timestamp).toISOString() : null,
    startedAt: job.processedOn ? new Date(job.processedOn).toISOString() : null,
    finishedAt: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
    error: job.failedReason || null,
    payload: job.data,
    result: job.returnvalue || null,
    gradingId: job.returnvalue?.id || null,
  };
}

async function resolveStatus(job) {
  if (!job) return null;
  const state = await job.getState();
  return mapBullJob(job, state);
}

function createRedisQueue(worker, redisUrl) {
  const connection = parseRedisUrl(redisUrl);
  const queue = new Queue(QUEUE_NAME, { connection });

  const bullWorker = new Worker(
    QUEUE_NAME,
    async (job) => {
      const onProgress = (stage, progress) => job.updateProgress({ stage, progress });
      return worker(job.data, onProgress);
    },
    { connection, concurrency: Number(process.env.GRADING_WORKER_CONCURRENCY || 2) },
  );

  bullWorker.on('failed', (job, err) => {
    console.error(`[grading-worker] job ${job?.id} failed:`, err.message);
  });

  return {
    mode: 'redis',
    queue,
    worker: bullWorker,

    async loadJobs() {},

    bindWorker() {},

    async enqueue(payload) {
      const id = crypto.randomUUID();
      await queue.add('grade', payload, {
        jobId: id,
        removeOnComplete: 200,
        removeOnFail: 100,
        attempts: 2,
        backoff: { type: 'exponential', delay: 2000 },
      });
      return {
        id,
        status: 'queued',
        progress: 0,
        stage: 'queued',
        backend: 'redis',
        createdAt: new Date().toISOString(),
        payload,
      };
    },

    async getJob(id) {
      const job = await queue.getJob(id);
      if (!job) return null;
      return resolveStatus(job);
    },

    async listJobs(filter = {}) {
      const states = filter.status
        ? [filter.status === 'processing' ? 'active' : filter.status === 'queued' ? 'waiting' : filter.status]
        : ['waiting', 'active', 'completed', 'failed', 'delayed'];
      const rows = await queue.getJobs(states, 0, 100, false);
      let mapped = [];
      for (const job of rows) {
        mapped.push(await resolveStatus(job));
      }
      mapped = mapped.filter(Boolean);
      if (filter.studentId) mapped = mapped.filter((j) => j.payload?.studentId === filter.studentId);
      if (filter.paperId) mapped = mapped.filter((j) => j.payload?.paperId === filter.paperId);
      return mapped.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    },
  };
}

module.exports = { createRedisQueue, QUEUE_NAME };
