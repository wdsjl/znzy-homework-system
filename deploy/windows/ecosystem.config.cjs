const path = require('path');

module.exports = {
  apps: [
    {
      name: 'znzy-homework',
      script: 'server/index.cjs',
      cwd: path.join(__dirname, '..', '..'),
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '800M',
      env: {
        API_PORT: '3200',
        SERVE_STATIC: '1',
        ASYNC_GRADING: '1',
        PUBLIC_ORIGIN: 'https://znzy.lhyun.net',
        CORS_ORIGIN: 'https://znzy.lhyun.net',
      },
    },
  ],
};
