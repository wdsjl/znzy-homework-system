const { createJsonStore } = require('./jsonStore.cjs');
const { createMysqlStore } = require('./mysqlStore.cjs');
const { createFormalMysqlStore } = require('./formalMysqlStore.cjs');

let storePromise;

function parseDatabaseUrl(url) {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 3306),
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.replace(/^\//, ''),
  };
}

async function createStore() {
  const databaseUrl = process.env.DATABASE_URL;
  const mysqlHost = process.env.MYSQL_HOST;

  if (databaseUrl || mysqlHost) {
    try {
      const mysql = require('mysql2/promise');
      const config = databaseUrl
        ? parseDatabaseUrl(databaseUrl)
        : {
            host: mysqlHost,
            port: Number(process.env.MYSQL_PORT || 3306),
            user: process.env.MYSQL_USER || 'root',
            password: process.env.MYSQL_PASSWORD || '',
            database: process.env.MYSQL_DATABASE || 'znzy_homework',
          };
      const pool = mysql.createPool({ ...config, waitForConnections: true, connectionLimit: 10 });
      await pool.query('SELECT 1');
      const useFormal = process.env.USE_FORMAL_SCHEMA === '1';
      const store = useFormal ? createFormalMysqlStore(pool) : createMysqlStore(pool);
      await store.init();
      console.log(`Storage: ${useFormal ? 'MySQL formal schema' : 'MySQL runtime'} (${config.host}/${config.database})`);
      return store;
    } catch (err) {
      console.warn('MySQL unavailable, falling back to JSON storage:', err.message);
    }
  }

  const store = createJsonStore();
  await store.init();
  console.log('Storage: JSON files (server/data/)');
  return store;
}

function getStore() {
  if (!storePromise) storePromise = createStore();
  return storePromise;
}

module.exports = { getStore };
