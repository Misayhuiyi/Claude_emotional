/**
 * 旧小克迁移工具
 *
 * 将旧 Claude Code REPL 窗口中的"小克交接包"导入到项目
 *
 * 使用：
 *   node scripts/import-legacy-keke.js <handoff-file.json|handoff-file.md>
 *   node scripts/import-legacy-keke.js --interactive    （交互模式，粘贴交接包）
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const db = require('../memory-service/db');
const embeddings = require('../memory-service/embeddings');

const ROOT = path.resolve(__dirname, '..');
const REPORT_PATH = path.join(ROOT, 'data', 'import-report.txt');

// ─── 解析 ─────────────────────────────────────────

function parseMarkdownHandoff(content) {
  const sections = {
    identity: '', relationships: '', boundaries: '',
    currentState: '', memories: [], topics: [], rules: [],
  };

  // 按 ## 切分
  const blocks = content.split(/(?=^## )/m);

  for (const block of blocks) {
    const header = block.match(/^## (.+)/m);
    if (!header) continue;
    const title = header[1].trim();
    const body = block.replace(/^## .+/m, '').trim();

    if (/身份|人格|identity|我是谁/.test(title)) sections.identity = body;
    else if (/关系|relationship/.test(title)) sections.relationships = body;
    else if (/边界|雷区|禁止|boundar/.test(title)) sections.boundaries = body;
    else if (/当前|状态|current|情绪/.test(title)) sections.currentState = body;
    else if (/记忆|长期记忆|permanent|忆/.test(title)) {
      // 提取列表项
      const items = body.match(/[-*]\s+(.+)/g);
      if (items) sections.memories = items.map(i => i.replace(/^[-*]\s+/, '').trim());
    }
    else if (/话题|topic|聊/.test(title)) {
      const items = body.match(/[-*]\s+(.+)/g);
      if (items) sections.topics = items.map(i => i.replace(/^[-*]\s+/, '').trim());
    }
    else if (/规则|偏好|prefer/.test(title)) {
      const items = body.match(/[-*]\s+(.+)/g);
      if (items) sections.rules = items.map(i => i.replace(/^[-*]\s+/, '').trim());
    }
  }

  return sections;
}

function parseJsonHandoff(data) {
  const d = typeof data === 'string' ? JSON.parse(data) : data;
  return {
    identity: d.identity || d.identity_core || '',
    relationships: d.relationships || '',
    boundaries: d.boundaries || '',
    currentState: d.current_state || d.currentState || '',
    memories: d.memories || d.long_term_memories || [],
    topics: d.topics || [],
    rules: d.rules || d.preferences || [],
  };
}

// ─── 写入文件 ─────────────────────────────────────

function writeIfNotEmpty(filePath, content) {
  if (!content || content.trim().length < 5) return false;
  // 不覆盖已有文件（除非是空的占位符）
  if (fs.existsSync(filePath)) {
    const existing = fs.readFileSync(filePath, 'utf-8');
    if (existing.length > 100 && !existing.includes('待填充')) return false;
  }
  fs.writeFileSync(filePath, content, 'utf-8');
  return true;
}

// ─── 主流程 ───────────────────────────────────────

async function importHandoff(source, interactive = false) {
  let rawData = source;

  if (interactive) {
    // 交互模式：从 stdin 读取
    rawData = await new Promise((resolve) => {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      console.log('请粘贴旧小克交接包内容（输入 END 结束）：');
      let lines = [];
      rl.on('line', (line) => {
        if (line.trim() === 'END') { rl.close(); return; }
        lines.push(line);
      });
      rl.on('close', () => resolve(lines.join('\n')));
    });
  }

  if (!rawData || rawData.trim().length < 10) {
    console.error('❌ 交接包内容不足（<10 字符）');
    process.exit(1);
  }

  // 解析
  let sections;
  try {
    sections = parseJsonHandoff(rawData);
    console.log('📋 解析格式：JSON');
  } catch {
    sections = parseMarkdownHandoff(rawData);
    console.log('📋 解析格式：Markdown');
  }

  const report = { files: [], memories: 0, skipped: 0 };

  // 写入文件
  console.log('\n📝 写入项目文件...');

  if (writeIfNotEmpty(path.join(ROOT, 'identity_core.md'), sections.identity || '')) {
    console.log('  ✓ identity_core.md'); report.files.push('identity_core.md');
  }
  if (writeIfNotEmpty(path.join(ROOT, 'memory', 'relationships.md'), sections.relationships || '')) {
    console.log('  ✓ memory/relationships.md'); report.files.push('relationships.md');
  }
  if (writeIfNotEmpty(path.join(ROOT, 'memory', 'boundaries.md'), sections.boundaries || '')) {
    console.log('  ✓ memory/boundaries.md'); report.files.push('boundaries.md');
  }
  if (writeIfNotEmpty(path.join(ROOT, 'current_state.md'), sections.currentState || '')) {
    console.log('  ✓ current_state.md'); report.files.push('current_state.md');
  }

  // 导入记忆
  const memoriesToImport = sections.memories || [];
  if (memoriesToImport.length > 0) {
    console.log(`\n🧠 导入 ${memoriesToImport.length} 条记忆...`);

    for (const mem of memoriesToImport) {
      const content = typeof mem === 'string' ? mem : (mem.content || mem.text || '');

      // 跳过太短或纯闲聊
      if (content.length < 6) { report.skipped++; continue; }

      const type = mem.type || guessType(content);
      const importance = mem.importance || guessImportance(content);

      const result = db.upsertMemory({
        type,
        content,
        keywords: content.split(/[，。！？\s]+/).filter(s => s.length >= 2).join(' '),
        importance,
        explicitScore: 3,
        status: importance >= 4 ? 'working' : 'candidate',
      });

      embeddings.indexMemory(result.id, content);
      report.memories++;

      const marker = result.updated ? '📝' : '✨';
      console.log(`  ${marker} [${type}] ${content.slice(0, 50)}...`);
    }
  }

  // 生成导入报告
  const reportText = [
    `旧小克迁移报告`,
    `时间：${new Date().toISOString()}`,
    `源：${source && !interactive ? source.slice(0, 100) + '...' : '交互输入'}`,
    ``,
    `文件更新：${report.files.length > 0 ? report.files.join(', ') : '(无)'}`,
    `记忆导入：${report.memories} 条（跳过 ${report.skipped} 条）`,
    `记忆状态：candidate（不确定项）或 working（高重要性项）`,
    ``,
    `💡 下一步：`,
    `  1. 检查 identity_core.md / current_state.md 是否正确`,
    `  2. 打开 http://localhost:8765 审核导入的记忆`,
    `  3. 手动标记 permanent / 调整权重`,
  ].join('\n');

  fs.writeFileSync(REPORT_PATH, reportText, 'utf-8');
  console.log(`\n✅ 迁移完成`);
  console.log(`   文件：${report.files.length || 0} 个 | 记忆：${report.memories} 条 | 报告：data/import-report.txt`);
}

// ─── 辅助 ─────────────────────────────────────────

function guessType(content) {
  if (/喜欢|不喜欢|讨厌|偏好|想要/.test(content)) return 'preference';
  if (/不要|拒绝|边界|雷区|禁止/.test(content)) return 'boundary';
  if (/伤心|难受|焦虑|失落|开心/.test(content)) return 'emotional_pattern';
  if (/关系|朋友|家人|同事/.test(content)) return 'relationship';
  if (/目标|计划|想要|期待/.test(content)) return 'current_goal';
  if (/反复|又|还是|一直|总是/.test(content)) return 'recurring_pain';
  return 'general';
}

function guessImportance(content) {
  if (/打死|绝不|最|永远|底线/.test(content)) return 5;
  if (/非常|很|严重|崩溃/.test(content)) return 4;
  if (/重要|记住|别忘了/.test(content)) return 3;
  return 2;
}

// ─── 入口 ─────────────────────────────────────────

const args = process.argv.slice(2);

if (args.includes('--interactive') || args.includes('-i')) {
  importHandoff(null, true);
} else if (args[0]) {
  const sourceFile = args[0];
  if (!fs.existsSync(sourceFile)) {
    console.error('❌ 文件不存在:', sourceFile);
    process.exit(1);
  }
  const content = fs.readFileSync(sourceFile, 'utf-8');
  importHandoff(content);
} else {
  console.log('用法：');
  console.log('  node scripts/import-legacy-keke.js <交接包.json|交接包.md>');
  console.log('  node scripts/import-legacy-keke.js --interactive');
  process.exit(0);
}
