/**
 * 记忆管理面板 HTTP Server
 *
 * 使用: node memory-service/admin-server.js
 * 访问: http://localhost:8765
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const db = require('./db');
const search = require('./search');
const gate = require('./gate');
const summarize = require('./summarize');

const PORT = 8765;

// ─── MIME ─────────────────────────────────────────
const MIME = {
  '.html': 'text/html;charset=utf-8',
  '.css': 'text/css;charset=utf-8',
  '.js': 'application/javascript;charset=utf-8',
  '.json': 'application/json;charset=utf-8',
};

// ─── API Handlers ──────────────────────────────────

function json(res, data, code = 200) {
  const body = JSON.stringify(data);
  res.writeHead(code, { 'Content-Type': 'application/json;charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      try { resolve(JSON.parse(body)); }
      catch { resolve({}); }
    });
  });
}

const API = {
  // 记忆列表 + 搜索
  async memories(req, res, q) {
    const limit = parseInt(q.limit) || 100;
    const status = q.status || 'all';
    const searchQuery = q.q || '';

    let results;
    if (searchQuery) {
      results = await search.hybridSearch(searchQuery, { limit, status: status === 'all' ? 'active' : status, noExpand: true });
    } else {
      results = db.getActiveMemories(limit);
      if (status !== 'all' && status !== 'active') {
        results = results.filter(r => r.status === status);
      }
    }
    json(res, results);
  },

  // 单条记忆
  async memory(req, res, id) {
    const mem = db.getMemoryById(id);
    if (!mem) return json(res, { error: 'not found' }, 404);
    const mentions = db.getMentionsForMemory(id);
    json(res, { ...mem, mentions });
  },

  // 更新记忆
  async updateMemory(req, res, id) {
    const body = await readBody(req);
    const existing = db.getMemoryById(id);
    if (!existing) return json(res, { error: 'not found' }, 404);

    const updates = {};
    if (body.content !== undefined) updates.content = body.content;
    if (body.type !== undefined) updates.type = body.type;
    if (body.status !== undefined) updates.status = body.status;
    if (body.priority !== undefined) updates.priority = body.priority;
    if (body.weight !== undefined) updates.weight = body.weight;
    if (body.importance !== undefined) updates.importance = body.importance;
    if (body.keywords !== undefined) updates.keywords = body.keywords;

    const result = db.updateMemory(id, updates);
    json(res, { success: true, id, updated: result.updated });
  },

  // 遗忘
  async forget(req, res, id) {
    const existing = db.getMemoryById(id);
    if (!existing) return json(res, { error: 'not found' }, 404);
    db.updateMemoryStatus(id, 'forgotten');
    json(res, { success: true, id, status: 'forgotten' });
  },

  // 统计
  stats(req, res) {
    const dbInstance = db.getDb();
    const total = dbInstance.prepare('SELECT COUNT(*) as c FROM memories').get().c;
    const byStatus = dbInstance.prepare('SELECT status, COUNT(*) as c FROM memories GROUP BY status').all();
    const byType = dbInstance.prepare('SELECT type, COUNT(*) as c FROM memories GROUP BY type').all();
    const msgCount = dbInstance.prepare('SELECT COUNT(*) as c FROM messages').get().c;
    const sumCount = dbInstance.prepare('SELECT COUNT(*) as c FROM summaries').get().c;
    const avgWeight = dbInstance.prepare("SELECT AVG(weight) as a FROM memories WHERE status != 'forgotten'").get().a || 0;

    json(res, { total, msgCount, sumCount, avgWeight: avgWeight.toFixed(1), byStatus, byType });
  },

  // 摘要列表
  summaries(req, res) {
    const dbInstance = db.getDb();
    const results = dbInstance.prepare('SELECT * FROM summaries ORDER BY created_at DESC LIMIT 50').all();
    json(res, results);
  },

  // 维护
  maintenance(req, res) {
    const result = gate.runMaintenance();
    json(res, { success: true, ...result });
  },
};

// ─── Router ────────────────────────────────────────

async function route(req, res) {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;
  const method = req.method;

  const memMatch = pathname.match(/^\/api\/memories\/([a-zA-Z0-9_]+)$/);

  try {
    if (method === 'GET' && pathname === '/api/memories') {
      return await API.memories(req, res, parsed.query);
    }
    if (method === 'GET' && memMatch) {
      return await API.memory(req, res, memMatch[1]);
    }
    if (method === 'PUT' && memMatch) {
      return await API.updateMemory(req, res, memMatch[1]);
    }
    if (method === 'DELETE' && memMatch) {
      return await API.forget(req, res, memMatch[1]);
    }
    if (method === 'GET' && pathname === '/api/stats') {
      return API.stats(req, res);
    }
    if (method === 'GET' && pathname === '/api/summaries') {
      return API.summaries(req, res);
    }
    if (method === 'POST' && pathname === '/api/maintenance') {
      return API.maintenance(req, res);
    }
    if (method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
      const html = fs.readFileSync(path.join(__dirname, 'admin.html'), 'utf-8');
      res.writeHead(200, { 'Content-Type': 'text/html;charset=utf-8' });
      return res.end(html);
    }
  } catch (e) {
    return json(res, { error: e.message }, 500);
  }

  json(res, { error: 'not found' }, 404);
}

// ─── Start ─────────────────────────────────────────

const server = http.createServer(route);
server.listen(PORT, () => {
  console.log(`\n  记忆管理面板: http://localhost:${PORT}\n`);
});
