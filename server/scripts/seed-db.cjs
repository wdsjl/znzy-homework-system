const fs = require('fs/promises');
const path = require('path');
const { getStore } = require('../store/index.cjs');

async function seedFromJson() {
  const store = await getStore();
  if (store.mode !== 'mysql') {
    console.log('Seed skipped: not using MySQL storage');
    return { seeded: 0, mode: store.mode };
  }

  const jsonPath = path.join(__dirname, '..', 'data', 'questions.json');
  const rows = JSON.parse(await fs.readFile(jsonPath, 'utf-8'));
  const existing = await store.listQuestions({});
  if (existing.length > 0) {
    console.log(`Seed skipped: ${existing.length} questions already in MySQL`);
    return { seeded: 0, mode: store.mode, skipped: true };
  }

  await store.createQuestions(rows);
  console.log(`Seeded ${rows.length} questions into MySQL`);
  return { seeded: rows.length, mode: store.mode };
}

if (require.main === module) {
  seedFromJson()
    .then((result) => {
      console.log(JSON.stringify(result));
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { seedFromJson };
