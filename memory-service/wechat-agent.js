/**
 * cc-connect Agent 包装器
 *
 * 微信消息 → 检索记忆 → 拼接上下文 → claude --bare --print → 记录消息+Gate → 回复微信
 */

const db = require('./db');
const search = require('./search');
const gate = require('./gate');
const contextManager = require('./context-manager');
const claudeRunner = require('./claude-runner');
const config = require('./config');

/**
 * 检查消息是否为每日总结，并标记到 daily-tracker
 */
function checkSummarySubmission(message) {
  try {
    if (message.startsWith('#总结') || message.startsWith('#今日总结') || message.startsWith('今日总结')) {
      const content = message.replace(/^#?(今日)?总结\s*/, '').trim();
      const dailyTracker = require('./proactive-service/daily-tracker');
      dailyTracker.markSummarySubmitted(content);
      console.log(`[wechat] 📝 已标记今日总结: ${content.slice(0, 30)}...`);
    }
  } catch {}
}

/**
 * 检查学习内容反馈
 */
function checkStudyFeedback(message) {
  try {
    const studyPusher = require('./proactive-service/study-pusher');
    studyPusher.handleFeedback(message);
  } catch {}
}

/**
 * 检查浪漫内容反馈（记录阿忆的反应）
 */
function checkRomanticFeedback(message) {
  try {
    const dailyTracker = require('./proactive-service/daily-tracker');
    dailyTracker.recordResponse();
  } catch {}
}

async function main() {
  // cc-connect 通过 stdin 传入消息
  let input = '';
  process.stdin.setEncoding('utf-8');
  process.stdin.on('data', d => input += d);
  process.stdin.on('end', async () => {
    const userMessage = input.trim();
    if (!userMessage) { process.exit(0); return; }

    // 检查各类特殊消息
    checkSummarySubmission(userMessage);
    checkStudyFeedback(userMessage);
    checkRomanticFeedback(userMessage);

    try {
      // 1. 写入消息
      const msgId = db.generateId('msg_');
      db.insertMessage({ id: msgId, role: 'user', content: userMessage });

      // 2. 检索记忆
      const memories = await search.hybridSearch(userMessage, { limit: config.CONTEXT.maxMemoryInject });
      const userMsgLower = userMessage.toLowerCase();

      // 3. 判断是否技术/工作请求
      const isTech = /写代码|代码|编程|帮我写|实现|函数|bug|调试|测试|部署|服务器|配置|安装|git|npm|node|python|js|ts|api|数据库|sql|docker|linux|命令|分析这段|技术方案|架构/.test(userMsgLower);

      // 4. 构建上下文（不带历史，cc-connect 自己管理会话）
      const { context } = contextManager.buildContext(userMessage, [], memories);

      // 5. 调用 Claude
      const model = isTech ? config.MODEL.professional : config.MODEL.companion;
      const result = await claudeRunner.run(context, { model });

      if (result.success) {
        // 6. 写入回复
        const replyId = db.generateId('msg_');
        db.insertMessage({ id: replyId, role: 'assistant', content: result.response });

        // 7. Memory Gate
        const gateResult = await gate.processGate(
          [{ role: 'user', content: userMessage }, { role: 'assistant', content: result.response }],
          replyId
        );

        // 8. 输出回复（cc-connect 读取 stdout 发送回微信）
        process.stdout.write(result.response);
      } else {
        process.stdout.write('嗯……我现在有点卡住了，等一下再跟我说好吗？');
      }
    } catch (e) {
      process.stderr.write('Error: ' + e.message);
      process.stdout.write('抱歉，刚有点状况。你再说一遍好不好？');
    }
  });
}

main();