/**
 * MCP Server - Memory Service
 *
 * 给 cc-connect / Claude Code 提供结构化 memory 工具
 * 通过 .mcp.json 注册
 */

const db = require('./db');
const search = require('./search');
const gate = require('./gate');
const summarize = require('./summarize');
const contextManager = require('./context-manager');

let input = '';

process.stdin.setEncoding('utf-8');
process.stdin.on('data', (d) => { input += d; });

process.stdin.on('end', async () => {
  try {
    const req = JSON.parse(input);
    const { method, params } = req;
    let result;

    switch (method) {
      case 'memory_search':
        result = await search.hybridSearch(params.query, {
          limit: params.limit || 10,
          noExpand: params.noExpand || false,
        });
        break;

      case 'memory_write':
        result = db.upsertMemory({
          type: params.type || 'general',
          content: params.content,
          keywords: params.keywords || '',
          importance: params.importance || 3,
          explicitScore: params.explicitScore || 5,
          status: params.status || 'permanent',
        });
        break;

      case 'memory_forget':
        result = db.updateMemoryStatus(params.id, 'forgotten');
        break;

      case 'memory_list':
        result = db.getActiveMemories(params.limit || 50).map(m => ({
          id: m.id, type: m.type, content: m.content,
          weight: m.weight, status: m.status, frequency: m.frequency,
        }));
        break;

      case 'memory_checkpoint':
        result = contextManager.saveCheckpoint(params.messages || []);
        break;

      case 'memory_summarize':
        result = await summarize.generateSummary(
          params.type || 'daily',
          params.start, params.end, params.title,
        );
        break;

      case 'memory_maintenance':
        result = gate.runMaintenance();
        break;

      case 'health':
        result = {
          status: 'ok',
          hotMemoryLoaded: !!contextManager.loadHotMemory().identityCore,
          dbPath: require('./config').PATHS.memoryDb,
        };
        break;

      default:
        result = { error: 'unknown method: ' + method };
    }

    process.stdout.write(JSON.stringify({ result }));
  } catch (e) {
    process.stdout.write(JSON.stringify({ error: e.message }));
  }
});
