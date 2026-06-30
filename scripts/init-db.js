/**
 * 初始化 SQLite 长期记忆数据库
 *
 * 使用：node scripts/init-db.js
 */

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.resolve(__dirname, '..', 'data', 'memory.db');

// 确保 data 目录存在
const fs = require('fs');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);

// 启用 WAL 模式，提高并发性能
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

console.log(`数据库：${DB_PATH}`);

// 1. messages 表
db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    source TEXT DEFAULT 'wechat',
    platform TEXT DEFAULT 'cc-connect',
    conversation_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
  CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
`);
console.log('  ✓ messages 表');

// 2. memories 表
db.exec(`
  CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK(type IN (
      'preference', 'boundary', 'relationship', 'event',
      'emotional_pattern', 'identity_fact', 'current_goal', 'recurring_pain', 'general'
    )),
    content TEXT NOT NULL,
    keywords TEXT DEFAULT '',
    importance REAL DEFAULT 1.0,
    frequency INTEGER DEFAULT 1,
    emotion_score REAL DEFAULT 0.0,
    explicit_score REAL DEFAULT 0.0,
    recency_score REAL DEFAULT 0.0,
    confidence REAL DEFAULT 0.7,
    weight REAL DEFAULT 0.0,
    status TEXT DEFAULT 'candidate' CHECK(status IN (
      'candidate', 'working', 'permanent', 'archived', 'forgotten'
    )),
    priority TEXT DEFAULT 'P3' CHECK(priority IN ('P0', 'P1', 'P2', 'P3')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen_at TEXT,
    valid_from TEXT,
    valid_to TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
  CREATE INDEX IF NOT EXISTS idx_memories_status ON memories(status);
  CREATE INDEX IF NOT EXISTS idx_memories_weight ON memories(weight DESC);
  CREATE INDEX IF NOT EXISTS idx_memories_updated ON memories(updated_at);
`);
console.log('  ✓ memories 表');

// 3. memory_mentions 表
db.exec(`
  CREATE TABLE IF NOT EXISTS memory_mentions (
    id TEXT PRIMARY KEY,
    memory_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    matched_text TEXT,
    emotion_score REAL DEFAULT 0.0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE,
    FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_mentions_memory ON memory_mentions(memory_id);
  CREATE INDEX IF NOT EXISTS idx_mentions_message ON memory_mentions(message_id);
`);
console.log('  ✓ memory_mentions 表');

// 4. summaries 表
db.exec(`
  CREATE TABLE IF NOT EXISTS summaries (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK(type IN ('daily', 'weekly', 'topic', 'context')),
    title TEXT,
    content TEXT NOT NULL,
    start_at TEXT,
    end_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_summaries_type ON summaries(type);
  CREATE INDEX IF NOT EXISTS idx_summaries_created ON summaries(created_at);
`);
console.log('  ✓ summaries 表');

// 5. memory_vectors 表（向量索引，阶段 5 使用）
db.exec(`
  CREATE TABLE IF NOT EXISTS memory_vectors (
    memory_id TEXT PRIMARY KEY,
    embedding_model TEXT NOT NULL,
    embedding BLOB NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
  );
`);
console.log('  ✓ memory_vectors 表');

// 6. FTS5 全文检索（对 memories 的 content 和 keywords 建索引）
db.exec(`
  CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
    content,
    keywords,
    content='memories',
    content_rowid='rowid'
  );
`);
console.log('  ✓ memories_fts (FTS5)');

// 触发器：保持 FTS5 与 memories 表同步
db.exec(`
  CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
    INSERT INTO memories_fts(rowid, content, keywords)
    VALUES (new.rowid, new.content, new.keywords);
  END;
`);
console.log('  ✓ INSERT 触发器');

db.exec(`
  CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
    INSERT INTO memories_fts(memories_fts, rowid, content, keywords)
    VALUES ('delete', old.rowid, old.content, old.keywords);
  END;
`);
console.log('  ✓ DELETE 触发器');

db.exec(`
  CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
    INSERT INTO memories_fts(memories_fts, rowid, content, keywords)
    VALUES ('delete', old.rowid, old.content, old.keywords);
    INSERT INTO memories_fts(rowid, content, keywords)
    VALUES (new.rowid, new.content, new.keywords);
  END;
`);
console.log('  ✓ UPDATE 触发器');

// 统计
const tableCounts = {
  messages: db.prepare('SELECT COUNT(*) as c FROM messages').get().c,
  memories: db.prepare('SELECT COUNT(*) as c FROM memories').get().c,
  summaries: db.prepare('SELECT COUNT(*) as c FROM summaries').get().c,
};

console.log('\n数据库初始化完成');
console.log(`  messages: ${tableCounts.messages} 条`);
console.log(`  memories: ${tableCounts.memories} 条`);
console.log(`  summaries: ${tableCounts.summaries} 条`);

db.close();
