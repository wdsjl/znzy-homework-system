const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

function createGradingJobQueue({ dataDir, processSubmission }) {
  const jobFile = path.join(dataDir, 'grading-jobs.json');
  const jobs = new Map();

  async function loadJobs() {
    try {
      const rows = JSON.parse(await fs.readFile(jobFile, 'utf-8'));
      for (const row of rows) jobs.set(row.jobId, row);
    } catch {
      // No persisted jobs yet.
    }
  }

  async function persist() {
    await fs.mkdir(path.dirname(jobFile), { recursive: true });
    await fs.writeFile(jobFile, JSON.stringify([...jobs.values()].slice(-500), null, 2), 'utf-8');
  }

  async function enqueue({ file, body }) {
    const job = {
      jobId: crypto.randomUUID(),
      status: 'queued',
      progress: 0,
      uploadId: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      error: '',
      result: null,
      meta: {
        fileName: file?.originalname || '',
        studentId: body?.studentId || '',
        assignmentId: body?.assignmentId || '',
        paperId: body?.paperId || '',
      },
    };
    jobs.set(job.jobId, job);
    await persist();
    setImmediate(() => run(job.jobId, { file, body }));
    return job;
  }

  async function run(jobId, payload) {
    const job = jobs.get(jobId);
    if (!job) return;
    try {
      update(job, { status: 'processing', progress: 15 });
      await persist();
      const result = await processSubmission(payload, {
        onProgress: async (progress, stage) => {
          update(job, { progress, stage });
          await persist();
        },
      });
      update(job, {
        status: 'done',
        progress: 100,
        uploadId: result.uploadId,
        result,
      });
    } catch (error) {
      update(job, { status: 'failed', progress: 100, error: error.message });
    }
    await persist();
  }

  async function get(jobId) {
    if (!jobs.size) await loadJobs();
    return jobs.get(jobId) || null;
  }

  async function list(filters = {}) {
    if (!jobs.size) await loadJobs();
    return [...jobs.values()]
      .filter((job) =>
        (!filters.studentId || job.meta.studentId === filters.studentId) &&
        (!filters.assignmentId || job.meta.assignmentId === filters.assignmentId) &&
        (!filters.status || job.status === filters.status)
      )
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, 100);
  }

  function update(job, patch) {
    Object.assign(job, patch, { updatedAt: new Date().toISOString() });
    jobs.set(job.jobId, job);
  }

  return { enqueue, get, list, loadJobs };
}

module.exports = { createGradingJobQueue };
