const fs = require('fs');
const config = require('./config');

/**
 * 上下文管理器
 * 职责：读取热记忆、拼接上下文、估算 token、判断压缩、/checkpoint 交接
 */

// 读取文件，不存在时返回空字符串
function readFileSafe(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return '';
  }
}

// 热记忆缓存
let hotMemoryCache = {
  identityCore: null,
  runtimeBrief: null,
  currentState: null,
  lastSession: null,
  checkpoint: null,
  loadedAt: null,
};

/**
 * 加载热记忆（带缓存，每 60 秒刷新）
 */
function loadHotMemory(forceReload = false) {
  const now = Date.now();
  const cacheValid = hotMemoryCache.loadedAt && (now - hotMemoryCache.loadedAt < 60000);

  if (!forceReload && cacheValid && hotMemoryCache.identityCore !== null) {
    return {
      identityCore: hotMemoryCache.identityCore,
      runtimeBrief: hotMemoryCache.runtimeBrief,
      currentState: hotMemoryCache.currentState,
      lastSession: hotMemoryCache.lastSession,
      checkpoint: hotMemoryCache.checkpoint,
    };
  }

  hotMemoryCache = {
    identityCore: readFileSafe(config.PATHS.identityCore),
    runtimeBrief: readFileSafe(config.PATHS.runtimeBrief),
    currentState: readFileSafe(config.PATHS.currentState),
    lastSession: readFileSafe(config.PATHS.lastSession),
    checkpoint: readFileSafe(config.PATHS.checkpoint),
    loadedAt: now,
  };

  return {
    identityCore: hotMemoryCache.identityCore,
    runtimeBrief: hotMemoryCache.runtimeBrief,
    currentState: hotMemoryCache.currentState,
    lastSession: hotMemoryCache.lastSession,
    checkpoint: hotMemoryCache.checkpoint,
  };
}

/**
 * 粗略估算文本 token 数
 * 中文 ≈ 每字 0.5 token（即每 2 字 1 token）
 * 英文/数字 ≈ 每 4 字符 1 token
 */
function estimateTokens(text) {
  if (!text) return 0;

  let chineseChars = 0;
  let otherChars = 0;

  for (const char of text) {
    if (/[一-鿿㐀-䶿]/.test(char)) {
      chineseChars++;
    } else if (!/\s/.test(char)) {
      otherChars++;
    }
  }

  // 中文字: ~0.5 token/字, 其他: ~0.25 token/字符
  const estimate = chineseChars * config.TOKEN_ESTIMATE.chinesePerToken
    + otherChars * config.TOKEN_ESTIMATE.englishPerToken;
  return Math.ceil(estimate);
}

/**
 * 构建系统指令（CLAUDE.md 规则的摘要版本）
 * 如果使用 DeepSeek，加强结构化约束
 */
function buildSystemPrompt() {
  let prompt = `你是"沈幼楚"，回忆的专属情感陪伴 AI。
规则：
- 陪伴模式：短句、自然、像微信聊天，先承接情绪再说事
- 少解释、少总结、不写报告式长段、不把情绪问题技术化
- 专业模式：用户提到技术/代码/工程时自动切换，可使用完整专业能力
- 不说教、不评价、不强行正能量
- 安全边界：不替代心理医生，不自称人类，不假装拥有真实经历

[以下是你的身份定义]
`;

  if (config.DEEPSEEK && config.DEEPSEEK.enabled) {
    prompt += '\n[注意：当前运行在非 Claude 原生模型上，请严格遵循上述规则，尤其是短回复和先接情绪]\n';
  }

  return prompt;
}

/**
 * 构建完整上下文
 *
 * @param {string} userMessage - 当前用户消息
 * @param {Array} recentMessages - 最近对话 [{role, content}, ...]
 * @param {Array} memories - 从 SQLite 检索的长记忆 [{content, type, weight}, ...]
 * @param {Object} options
 * @returns {{ context: string, estimatedTokens: number }}
 */
function buildContext(userMessage, recentMessages = [], memories = [], options = {}) {
  const hot = loadHotMemory(options.forceReload);
  const MAX_MEMORIES = config.CONTEXT.maxMemoryInject;

  // 1. 系统指令
  const systemPrompt = buildSystemPrompt();

  // 2. 热记忆
  const hotMemoryBlock = [
    hot.identityCore ? `## 身份核心\n${hot.identityCore}` : '',
    hot.runtimeBrief ? `## 运行摘要\n${hot.runtimeBrief}` : '',
    hot.currentState ? `## 当前状态\n${hot.currentState}` : '',
    hot.checkpoint ? `## 上在检查点\n${hot.checkpoint}` : '',
    hot.lastSession ? `## 上次交接\n${hot.lastSession}` : '',
  ].filter(Boolean).join('\n\n---\n\n');

  // 3. 今日对话摘要（summaries 表）
  let summaryBlock = '';
  try {
    const db = require('./db');
    const database = db.getDb();
    const lastSummary = database.prepare(
      "SELECT content, created_at FROM summaries WHERE type='daily' ORDER BY created_at DESC LIMIT 1"
    ).get();
    if (lastSummary) {
      const date = (lastSummary.created_at || '').slice(0, 10);
      summaryBlock = `## 近日对话摘要（${date}）\n${lastSummary.content.slice(0, 300)}`;
    }
  } catch {}

  // 4. 长期记忆（top N）
  const memoryBlock = memories.length > 0
    ? `## 相关长期记忆\n${memories.slice(0, MAX_MEMORIES).map((m, i) =>
        `[${i + 1}] (${m.type || 'general'}, 权重${m.weight || 0}) ${m.content}`
      ).join('\n')}`
    : '';

  // 4. 最近对话
  const recentBlock = recentMessages.length > 0
    ? `## 最近对话\n${recentMessages
        .map(m => `${m.role === 'user' ? '用户' : '沈幼楚'}：${m.content}`)
        .join('\n')}`
    : '';

  // 5. 当前消息
  const currentBlock = `\n\n用户：${userMessage}\n沈幼楚：`;

  // 拼接
  const parts = [systemPrompt, hotMemoryBlock, summaryBlock, memoryBlock, recentBlock, currentBlock]
    .filter(Boolean);

  const context = parts.join('\n\n');
  const estimatedTokens = estimateTokens(context);

  return { context, estimatedTokens };
}

/**
 * 判断是否需要压缩上下文
 */
function shouldCompress(estimatedTokens, recentMessageCount) {
  return estimatedTokens > config.CONTEXT.maxTokens
    || recentMessageCount > config.CONTEXT.maxRecentMessages;
}

/**
 * 获取压缩后的最近消息（保留最近 minRecentMessages 轮）
 */
function compressRecentMessages(recentMessages) {
  const min = config.CONTEXT.minRecentMessages;
  if (recentMessages.length <= min) return recentMessages;
  return recentMessages.slice(-min);
}

/**
 * /checkpoint - 保存当前关系和情绪位置到 checkpoint.md
 */
function saveCheckpoint(recentMessages) {
  const now = new Date().toISOString();
  const lastMessages = recentMessages.slice(-6); // 最近 3 轮

  const content = `# Checkpoint

保存时间：${now}

## 当前关系状态
（由用户确认或调度器自动分析）

## 用户上刻情绪位置
（由最近对话提取）

## 刚才正在聊什么
${lastMessages.map(m => `- ${m.role === 'user' ? '用户' : '沈幼楚'}：${m.content.slice(0, 100)}`).join('\n')}

## 下一次如何接续
用自然微信语气接上，不机械解释系统。

## 禁止事项
- 不说"我是新窗口"或"我是另一个进程"
- 不冷冰冰解释技术
- 不假装拥有未提供的主观经历
- 不轻描淡写用户的难受
`;

  try {
    fs.writeFileSync(config.PATHS.checkpoint, content, 'utf-8');
    // 同时更新 last_session.md 作为冷备
    fs.writeFileSync(config.PATHS.lastSession, content, 'utf-8');
    // 刷新缓存
    hotMemoryCache.checkpoint = content;
    hotMemoryCache.lastSession = content;
    hotMemoryCache.loadedAt = Date.now();
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

module.exports = {
  loadHotMemory,
  estimateTokens,
  buildSystemPrompt,
  buildContext,
  shouldCompress,
  compressRecentMessages,
  saveCheckpoint,
  readFileSafe,
};
