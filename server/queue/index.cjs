const memoryQueue = require('./memoryQueue.cjs');
const { createRedisQueue } = require('./redisQueue.cjs');

let queueImpl = null;

async function initGradingQueue(worker) {
  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) {
    try {
      queueImpl = createRedisQueue(worker, redisUrl);
      await queueImpl.loadJobs();
      console.log(`Grading queue: Redis (${redisUrl})`);
      return queueImpl;
    } catch (err) {
      console.warn('Redis queue unavailable, falling back to memory queue:', err.message);
    }
  }

  queueImpl = memoryQueue;
  memoryQueue.bindWorker(worker);
  await memoryQueue.loadJobs();
  console.log('Grading queue: memory (server/data/grading-jobs.json)');
  return queueImpl;
}

function getGradingQueue() {
  if (!queueImpl) throw new Error('Grading queue not initialized');
  return queueImpl;
}

module.exports = { initGradingQueue, getGradingQueue };
