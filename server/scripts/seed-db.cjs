const fs = require('fs/promises');
const path = require('path');
const { getStore } = require('../store/index.cjs');

async function seedFromJson() {
  const store = await getStore();
  if (!store.mode.startsWith('mysql')) {
    console.log(JSON.stringify({ seeded: 0, mode: store.mode, skipped: true, reason: 'not mysql' }));
    return;
  }

  const jsonPath = path.join(__dirname, '..', 'data', 'questions.json');
  const rows = JSON.parse(await fs.readFile(jsonPath, 'utf-8'));
  const existing = await store.listQuestions({});
  if (existing.length > 0) {
    console.log(JSON.stringify({ seeded: 0, mode: store.mode, skipped: true, existing: existing.length }));
    return;
  }

  await store.createQuestions(rows);
  console.log(JSON.stringify({ seeded: rows.length, mode: store.mode }));
}

if (require.main === module) {
  seedFromJson().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { seedFromJson };
