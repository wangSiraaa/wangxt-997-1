const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db');
const routes = require('./routes');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.use('/api', routes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use((req, res, next) => {
  try {
    db.saveToDisk();
  } catch(e) {}
  next();
});

async function start() {
  await db.init();
  app.listen(PORT, () => {
    console.log(`维修资金管理系统后端服务已启动: http://localhost:${PORT}`);
  });
}

start().catch(err => {
  console.error('启动失败:', err);
  process.exit(1);
});

module.exports = app;
