/**
 * 记忆备份工具
 *
 * 使用：
 *   node scripts/backup-memory.js              # 备份数据库
 *   node scripts/backup-memory.js --json       # 导出 JSON
 *   node scripts/backup-memory.js --json > export.json   # 完整导出
 *   node scripts/backup-memory.js --cleanup 7  # 保留最近 7 个备份
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const ROOT = path.resolve(__dirname, '..');
const DB_PATH = path.join(ROOT, 'data', 'memory.db');
const BACKUP_DIR = path.join(ROOT, 'data', 'backups');

fs.mkdirSync(BACKUP_DIR, { recursive: true });

const args = process.argv.slice(2);
const mode = args[0] || '';

// ─── SQLite 备份 ──────────────────────────────────

function backupDatabase() {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dest = path.join(BACKUP_DIR, `memory-${ts}.db`);

  // 直接复制文件（better-sqlite3 backup API 不同版本签名不兼容）
  fs.copyFileSync(DB_PATH, dest);
  // 同时复制 WAL 和 SHM（如果存在）
  if (fs.existsSync(DB_PATH + '-wal')) fs.copyFileSync(DB_PATH + '-wal', dest + '-wal');
  if (fs.existsSync(DB_PATH + '-shm')) fs.copyFileSync(DB_PATH + '-shm', dest + '-shm');

  const stat = fs.statSync(dest);
  console.log(`✓ 备份完成: ${dest}`);
  console.log(`  大小: ${(stat.size / 1024).toFixed(1)} KB`);

  return dest;
}

// ─── JSON 导出 ────────────────────────────────────

function exportToJson() {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  const data = {
    exported_at: new Date().toISOString(),
    messages: db.prepare('SELECT * FROM messages ORDER BY created_at').all(),
    memories: db.prepare('SELECT * FROM memories ORDER BY weight DESC').all(),
    summaries: db.prepare('SELECT * FROM summaries ORDER BY created_at DESC').all(),
    mentions: db.prepare(`
      SELECT mm.*, m.content as memory_content
      FROM memory_mentions mm
      LEFT JOIN memories m ON mm.memory_id = m.id
      ORDER BY mm.created_at DESC
    `).all(),
  };

  db.close();

  const json = JSON.stringify(data, null, 2);
  const dest = path.join(BACKUP_DIR, `export-${new Date().toISOString().slice(0, 10)}.json`);
  fs.writeFileSync(dest, json, 'utf-8');

  const stat = fs.statSync(dest);
  console.log(`✓ 导出完成: ${dest}`);
  console.log(`  大小: ${(stat.size / 1024).toFixed(1)} KB`);
  console.log(`  记忆: ${data.memories.length} 条 | 消息: ${data.messages.length} 条 | 摘要: ${data.summaries.length} 条`);

  return dest;
}

// ─── 清理旧备份 ───────────────────────────────────

function cleanupBackups(keepCount) {
  const files = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith('memory-') && f.endsWith('.db'))
    .map(f => ({ name: f, path: path.join(BACKUP_DIR, f), mtime: fs.statSync(path.join(BACKUP_DIR, f)).mtime }))
    .sort((a, b) => b.mtime - a.mtime); // 新 → 旧

  if (files.length <= keepCount) {
    console.log(`备份数: ${files.length}（保留上限: ${keepCount}，无需清理）`);
    return;
  }

  const toDelete = files.slice(keepCount);
  for (const f of toDelete) {
    fs.unlinkSync(f.path);
    console.log(`  已删除: ${f.name}`);
  }

  console.log(`✓ 清理完成，保留 ${keepCount} 个最新备份`);
}

// ─── 入口 ─────────────────────────────────────────

if (mode === '--cleanup' || mode === '-c') {
  const keep = parseInt(args[1]) || 7;
  cleanupBackups(keep);
} else if (mode === '--json' || mode === '-j') {
  exportToJson();
} else {
  // 默认：数据库备份
  backupDatabase();

  // 自动清理旧备份（保留 7 天）
  const files = fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith('memory-') && f.endsWith('.db'));
  if (files.length > 7) {
    console.log('  自动清理旧备份...');
    cleanupBackups(7);
  }
}
