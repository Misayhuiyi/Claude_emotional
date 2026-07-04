/**
 * 自动摘要模块
 *
 * 职责：上下文过长时自动调用 Claude 压缩历史对话
 *   1. 上下文压缩（主流程，自动触发）
 *   2. 每日/每周/主题摘要（cc-connect /cron 触发）
 *   3. 压缩后更新 current_state.md
 */

const claudeRunner = require('./claude-runner');
const db = require('./db');
const config = require('./config');
const fs = require('fs');
const path = require('path');

// ─── 上下文压缩（主流程）────────────────────────

/**
 * 将早期对话压缩为摘要
 *
 * @param {Array} oldMessages - 需要被压缩的早期对话
 * @param {Array} keepMessages - 保留的最近几轮（不被压缩，但要给 Claude 看以便接续）
 * @returns {string} 压缩后的摘要文本
 */
async function compressContext(oldMessages, keepMessages = []) {
  if (oldMessages.length === 0) return '';

  const oldText = oldMessages
    .map(m => `${m.role === 'user' ? '用户' : '小克'}：${m.content}`)
    .join('\n');

  const recentText = keepMessages.length > 0
    ? '\n\n即将接续的对话（保留原样，供参考情绪位置）：\n' +
      keepMessages.map(m => `${m.role === 'user' ? '用户' : '小克'}：${m.content}`).join('\n')
    : '';

  const prompt = `请将以下早期对话压缩为一条摘要（200-500 字）。

要求：
- 保留关键信息：话题、情绪变化、重要决定、用户偏好
- 保留情绪位置：用户当时的状态和情感基调
- 省略闲聊和重复内容
- 用自然的中文叙述
- 只输出摘要文本，不要加标记

早期对话：
${oldText}
${recentText}

摘要：`;

  try {
    const result = await claudeRunner.run(prompt, {
      model: config.MODEL.companion,
      timeout: 30000,
      bare: true,
    });

    if (result.success && result.response) {
      return result.response.trim();
    }
    return `[早期对话摘要：${oldMessages.length} 条消息，涉及话题包括：...]`;
  } catch {
    return `[早期对话摘要：${oldMessages.length} 条消息]`;
  }
}

// ─── 每日/每周/主题摘要───────────────────────────

/**
 * 生成指定时间段的摘要
 */
async function generateSummary(type, startAt, endAt, title = '') {
  // 从数据库获取对应时间段的消息
  const messages = db.getRecentMessages(200); // TODO: 按时间范围筛选

  if (messages.length < 4) return null;

  const conversationText = messages
    .map(m => `${m.role === 'user' ? '用户' : '小克'}：${m.content}`)
    .join('\n');

  const prompt = `请为以下对话生成一个${type === 'daily' ? '每日' : type === 'weekly' ? '每周' : '主题'}摘要（300-800 字）。

${title ? `主题：${title}` : ''}

要求（严格规则，必须遵守）：
	- **只概括对话中实际出现的内容**，不要编造没有发生的事
	- 不要添加对话中不存在的场景、天气、情绪或事件
	- 不清楚的地方写对话中未提及
	- 记录用户表达的关键偏好或边界
	- 记录需要记住的重要信息
	- 用自然中文叙述，不要夸大
	- 只输出摘要，不要加标记

	对话：
${conversationText}

摘要：`;

  try {
    const result = await claudeRunner.run(prompt, {
      model: config.MODEL.companion,
      timeout: 30000,
      bare: true,
    });

    if (result.success && result.response) {
      const content = result.response.trim();
      const summaryId = db.generateId('sum_');

      // 写入 summaries 表
      const database = db.getDb();
      database.prepare(`
        INSERT INTO summaries (id, type, title, content, start_at, end_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(summaryId, type, title || null, content, startAt || null, endAt || null);

      // 同时写入 markdown 文件
      const dateStr = new Date().toISOString().slice(0, 10);
      let mdPath;
      if (type === 'daily') {
        mdPath = path.join(config.PATHS.memorySummaries, 'daily', `${dateStr}.md`);
      } else if (type === 'weekly') {
        mdPath = path.join(config.PATHS.memorySummaries, 'weekly', `${dateStr}.md`);
      } else {
        const slug = (title || 'topic').replace(/[\/\\]/g, '_').slice(0, 30);
        mdPath = path.join(config.PATHS.memorySummaries, 'daily', `topic_${slug}.md`);
      }

      fs.mkdirSync(path.dirname(mdPath), { recursive: true });
      fs.writeFileSync(mdPath, `# ${title || type} 摘要 (${dateStr})\n\n${content}`, 'utf-8');

      return { id: summaryId, content, type };
    }
  } catch (err) {
    console.error('摘要生成失败:', err.message);
  }

  return null;
}

// ─── 压缩后更新 current_state.md ─────────────────

/**
 * 基于最近对话和摘要，更新 current_state.md
 */
async function updateCurrentState(recentMessages, latestSummary = '') {
  const recentText = recentMessages.slice(-6)
    .map(m => `${m.role === 'user' ? '用户' : '小克'}：${m.content}`)
    .join('\n');

  const prompt = `基于以下最近对话，更新用户当前状态描述（200-400 字）。

输出格式（只输出内容）：

## 最近几天状态
（简要描述）

## 当前主要情绪
（1-2 句）

## 正在进行的话题
（1-2 个）

## 最近需要避开的话题或表达
（如有）

${latestSummary ? '之前的摘要供参考：\n' + latestSummary + '\n' : ''}

最近对话：
${recentText}`;

  try {
    const result = await claudeRunner.run(prompt, {
      model: config.MODEL.companion,
      timeout: 20000,
      bare: true,
    });

    if (result.success && result.response) {
      fs.writeFileSync(config.PATHS.currentState, result.response.trim(), 'utf-8');
      return true;
    }
  } catch {
    // 非关键路径，失败不处理
  }
  return false;
}

module.exports = {
  compressContext,
  generateSummary,
  updateCurrentState,
};
