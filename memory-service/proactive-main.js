/**
 * Proactive Main - 主动资讯服务主入口
 *
 * 启动调度引擎，注册 MCP 工具。
 * 作为独立后台进程运行：
 *   node memory-service/proactive-main.js
 */

const scheduler = require('./proactive-service/scheduler');
const dailyTracker = require('./proactive-service/daily-tracker');

async function main() {
  console.log('═'.repeat(50));
  console.log('  沈幼楚 - 主动资讯服务');
  console.log('═'.repeat(50));
  console.log(`  启动时间: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`);
  console.log(`  勿扰时段: 23:30-08:30`);
  console.log(`  每日上限: ${require('./config').PROACTIVE.maxDaily} 条`);
  console.log(`  最小间隔: ${require('./config').PROACTIVE.minGapMinutes} 分钟`);
  console.log('═'.repeat(50));

  // 启动调度器
  scheduler.start();

  // 保持进程运行
  process.on('SIGINT', () => {
    console.log('\n[proactive] 收到 SIGINT，优雅退出');
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('\n[proactive] 收到 SIGTERM，优雅退出');
    process.exit(0);
  });

  // 输出状态（每小时一次）
  setInterval(() => {
    const state = dailyTracker.getState();
    console.log(`[proactive] 状态: 今日推送 ${state.pushCount}/${require('./config').PROACTIVE.maxDaily} 条 | 上次: ${state.lastPushAt ? new Date(state.lastPushAt).toLocaleString() : '无'}`);
  }, 3600000);
}

main().catch(e => {
  console.error('[proactive] 启动失败:', e.message);
  process.exit(1);
});
