/**
 * 情感陪伴 Agent - Memory Service 主入口
 *
 * ┌──────────┐   ┌───────────┐   ┌───────────────┐   ┌──────────┐
 * │ 微信消息  │──→│ cc-connect │──→│ Claude Code   │──→│ 微信回复  │
 * └──────────┘   └───────────┘   │ （本项目目录） │   └──────────┘
 *                               └───┬───────────┘
 *                                   │ 调用本 Memory Service
 *                              ┌────▼────────────┐
 *                              │ 热记忆加载       │
 *                              │ SQLite 记忆检索   │
 *                              │ Memory Gate      │
 *                              │ 自动摘要         │
 *                              │ 上下文管理       │
 *                              └─────────────────┘
 *
 * cc-connect 负责：微信入口、会话管理、Agent CLI 调用、模型/Provider 切换、定时任务
 * 本 Memory Service 负责：人格、长期记忆、记忆权重、上下文压缩、自动摘要、遗忘机制
 *
 * 使用方式：
 *   1. 生产模式：cc-connect 调用本项目，Claude Code 读取 CLAUDE.md 并调用 memory tools
 *   2. 测试模式：node memory-service/index.js（终端 REPL）
 */

const readline = require('readline');
const contextManager = require('./context-manager');
const claudeRunner = require('./claude-runner');
const config = require('./config');
const db = require('./db');
const search = require('./search');
const gate = require('./gate');
const summarize = require('./summarize');

// 对话历史（内存中保留最近 N 轮）
let recentMessages = [];
let messageIndex = 0;
// 当前会话 ID
const sessionId = 'session_' + Date.now();

function isProfessionalRequest(message) {
  const techKeywords = [
    '写代码', '代码', '编程', '帮我写', '实现', '函数', '类', '接口',
    'bug', 'debug', '调试', '测试', '部署', '服务器', '配置', '安装',
    'git', 'npm', 'node', 'python', 'js', 'ts', 'api', '数据库', 'sql',
    'docker', 'linux', '命令', '分析这段', '技术方案', '架构',
  ];
  return techKeywords.some(kw => message.includes(kw));
}

/**
 * processMessage - 处理一条用户消息
 *
 * 此函数同时供：
 *   A) 终端 REPL 测试模式（下方 startRepl）
 *   B) cc-connect 通过 Claude Code tools 调用（阶段 2 后）
 */
async function processMessage(userMessage, contextMessages = null) {
  messageIndex++;

  // 使用传入的消息历史或默认内存中的历史
  const history = contextMessages || recentMessages;

  // 写入 messages 表
  db.insertMessage({
    id: db.generateId('msg_'),
    role: 'user',
    content: userMessage,
    conversationId: sessionId,
  });

  // 检查是否需要压缩
  let compressedHistory = history;
  let compressionSummary = '';

  // 🔍 FTS5 关键词检索长期记忆
  const memories = await search.hybridSearch(userMessage, { limit: config.CONTEXT.maxMemoryInject });

  // 先用当前历史拼接上下文并估算 token，必要时再压缩后重建
  let { context, estimatedTokens } = contextManager.buildContext(
    userMessage, compressedHistory, memories,
  );

  if (contextManager.shouldCompress(estimatedTokens, history.length)) {
    console.log('  ⚡ 触发上下文压缩...');

    // 保留最近 3 轮，更早的压缩为摘要
    const keepCount = config.CONTEXT.minRecentMessages;
    const oldMessages = history.slice(0, -keepCount);
    const recentForKeep = history.slice(-keepCount);

    if (oldMessages.length > 0) {
      compressionSummary = await summarize.compressContext(oldMessages, recentForKeep);
      console.log('  摘要长度:', compressionSummary.length, '字');

      // 压缩后的历史 = 摘要 + 最近 3 轮
      compressedHistory = [
        { role: 'system', content: `[对话摘要：${compressionSummary}]` },
        ...recentForKeep,
      ];

      // 非阻塞：后台更新 current_state.md
      setImmediate(async () => {
        try {
          await summarize.updateCurrentState(recentForKeep, compressionSummary);
          console.log('  📝 current_state.md 已更新');
        } catch (e) { /* 非关键 */ }
      });

      ({ context, estimatedTokens } = contextManager.buildContext(
        userMessage, compressedHistory, memories,
      ));
    }
  }

  // 模型选择
  const model = isProfessionalRequest(userMessage)
    ? config.MODEL.professional
    : config.MODEL.companion;

  const result = await claudeRunner.run(context, {
    model,
    timeout: config.CLAUDE.timeout,
  });

  if (result.success) {
    // 写入 assistant 消息
    const msgId = db.generateId('msg_');
    db.insertMessage({
      id: msgId,
      role: 'assistant',
      content: result.response,
      conversationId: sessionId,
    });

    // 更新历史：如果压缩过则用压缩版，否则用原版
    const baseHistory = (compressedHistory !== history) ? compressedHistory : history;
    baseHistory.push({ role: 'user', content: userMessage });
    baseHistory.push({ role: 'assistant', content: result.response });

    // 同步到全局 recentMessages（仅终端 REPL 模式使用）
    if (contextMessages === null) {
      recentMessages = baseHistory;
    }

    // 🧠 Memory Gate：从回复中抽取候选记忆（非阻塞）
    setImmediate(async () => {
      try {
        const gateResult = await gate.processGate(baseHistory, msgId);
        if (gateResult.extracted > 0) {
          console.log(`  🧠 Memory Gate: 抽取 ${gateResult.extracted} 条记忆`);
        }
      } catch (e) { /* Gate 失败不应影响主流程 */ }
    });
  }

  return {
    ...result,
    estimatedTokens,
    messageIndex,
    history: compressedHistory !== history ? compressedHistory : history,
    memoriesFound: memories.length,
    compressed: compressionSummary.length > 0,
  };
}

/**
 * startRepl - 终端测试模式
 *
 * 用于本地验证，cc-connect 接入后不再使用此入口。保留以便调试。
 */
function startRepl() {
  console.log('═'.repeat(50));
  console.log('  情感陪伴 Agent - 小克');
  console.log('  Memory Service（测试模式）');
  console.log('  claude --bare --print');
  console.log('═'.repeat(50));
  console.log('  命令：/exit | /mem | /checkpoint');
  console.log('  架构：cc-connect（微信入口）+ Memory Service（本项目）');
  console.log('═'.repeat(50));

  const hot = contextManager.loadHotMemory();
  console.log('  热记忆：');
  console.log(`    identity_core.md  ${hot.identityCore ? '✓' : '✗'}`);
  console.log(`    runtime_brief.md  ${hot.runtimeBrief ? '✓' : '✗'}`);
  console.log(`    current_state.md  ${hot.currentState ? '✓' : '✗'}`);
  console.log(`    last_session.md   ${hot.lastSession ? '✓' : '✗'}`);
  console.log(`    checkpoint.md     ${hot.checkpoint ? '✓' : '✗'}`);
  console.log('═'.repeat(50));

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '\n你：',
  });

  rl.prompt();

  rl.on('line', async (line) => {
    const input = line.trim();

    if (input === '/exit') {
      console.log('再见。');
      process.exit(0);
    }

    if (input === '/mem') {
      console.log(`\n  对话历史: ${recentMessages.length} 条`);
      recentMessages.forEach((m, i) => {
        const prefix = m.role === 'user' ? '你' : '小克';
        const preview = m.content.length > 80
          ? m.content.slice(0, 80) + '...'
          : m.content;
        console.log(`    [${i}] ${prefix}: ${preview}`);
      });
      rl.prompt();
      return;
    }

    if (input === '/checkpoint') {
      console.log('  ⚡ 生成 checkpoint...');
      contextManager.saveCheckpoint(recentMessages);
      rl.prompt();
      return;
    }

    if (input === '') {
      rl.prompt();
      return;
    }

    await processMessage(input);
    rl.prompt();
  });

  rl.on('close', () => {
    console.log('\nMemory Service 已停止。');
    process.exit(0);
  });
}

// 入口
if (require.main === module) {
  startRepl();
}

module.exports = { processMessage, config };
