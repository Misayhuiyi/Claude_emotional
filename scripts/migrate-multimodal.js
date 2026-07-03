/**
 * Additive Migration - 多模态升级
 *
 * 只新增表，不修改旧表。
 * 可重复执行——已有 migration 记录则跳过。
 *
 * 使用：node scripts/migrate-multimodal.js
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.resolve(__dirname, '..', 'data', 'memory.db');
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

console.log(`数据库：${DB_PATH}`);

// ─── Migration 记录表 ──────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);
console.log('  ✓ schema_migrations 表');

function alreadyApplied(name) {
  const row = db.prepare('SELECT id FROM schema_migrations WHERE name = ?').get(name);
  return !!row;
}

function markApplied(name) {
  db.prepare('INSERT OR IGNORE INTO schema_migrations (id, name) VALUES (?, ?)').run(
    'mig_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    name
  );
}

// ─── Migration 1: info_sources ─────────────────────

if (!alreadyApplied('info_sources')) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS info_sources (
      id TEXT PRIMARY KEY,
      source_type TEXT NOT NULL CHECK(source_type IN ('weather', 'news', 'trend', 'ai', 'study')),
      title TEXT,
      url TEXT,
      summary TEXT,
      hash TEXT,
      delivered INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_info_sources_type ON info_sources(source_type);
    CREATE INDEX IF NOT EXISTS idx_info_sources_delivered ON info_sources(delivered);
  `);
  markApplied('info_sources');
  console.log('  ✓ info_sources 表');
} else {
  console.log('  - info_sources 表已存在，跳过');
}

// ─── Migration 2: media_assets（预创建，供后续阶段使用）─

if (!alreadyApplied('media_assets')) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS media_assets (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK(type IN ('image', 'voice', 'video', 'file')),
      path TEXT NOT NULL,
      sha256 TEXT,
      mime TEXT,
      source TEXT DEFAULT 'wechat',
      message_id TEXT,
      summary TEXT,
      transcript TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_media_assets_type ON media_assets(type);
    CREATE INDEX IF NOT EXISTS idx_media_assets_message ON media_assets(message_id);
  `);
  markApplied('media_assets');
  console.log('  ✓ media_assets 表（预创建）');
} else {
  console.log('  - media_assets 表已存在，跳过');
}

// ─── Migration 3: proactive_tasks（预创建）───────────

if (!alreadyApplied('proactive_tasks')) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS proactive_tasks (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      title TEXT,
      reason TEXT,
      scheduled_at TEXT,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'sent', 'skipped', 'paused', 'cancelled')),
      payload_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_proactive_tasks_status ON proactive_tasks(status);
    CREATE INDEX IF NOT EXISTS idx_proactive_tasks_scheduled ON proactive_tasks(scheduled_at);
  `);
  markApplied('proactive_tasks');
  console.log('  ✓ proactive_tasks 表（预创建）');
} else {
  console.log('  - proactive_tasks 表已存在，跳过');
}

// ─── Migration 4: sticker_events（预创建）────────────

if (!alreadyApplied('sticker_events')) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sticker_events (
      id TEXT PRIMARY KEY,
      sticker_id TEXT NOT NULL,
      intent TEXT,
      emotion TEXT,
      message_id TEXT,
      sent INTEGER DEFAULT 0,
      reason TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  markApplied('sticker_events');
  console.log('  ✓ sticker_events 表（预创建）');
} else {
  console.log('  - sticker_events 表已存在，跳过');
}

// ─── 汇总 ──────────────────────────────────────────

const tableCounts = db.prepare(`
  SELECT COUNT(*) as c FROM (
    SELECT name FROM sqlite_master WHERE type='table'
  )
`).get().c;

console.log(`\nMigration 完成，当前 ${tableCounts} 个表`);
console.log('所有操作均为 additive，未修改旧表。');

db.close();
