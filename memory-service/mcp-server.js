/**
 * MCP Server - Memory Service
 *
 * 实现 MCP 协议，让 Claude Code 可以直接调用记忆工具。
 * 通过 stdio JSON-RPC 2.0 与 Claude 通信。
 */

const db = require('./db');
const search = require('./search');
const gate = require('./gate');

const TOOLS = [
  {
    name: 'memory_search',
    description: '检索与用户消息相关的长期记忆',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词或用户消息' },
        limit: { type: 'number', default: 5, description: '返回条数' },
      },
      required: ['query'],
    },
  },
  {
    name: 'memory_write',
    description: '写入一条永久记忆',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: '记忆内容' },
        type: { type: 'string', enum: ['preference','boundary','relationship','event','emotional_pattern','identity_fact','current_goal','recurring_pain','general'], default: 'general' },
        importance: { type: 'number', default: 3 },
      },
      required: ['content'],
    },
  },
];

// ─── JSON-RPC 2.0 ─────────────────────────────────

let buffer = '';

process.stdin.setEncoding('utf-8');
process.stdin.on('data', (data) => {
  buffer += data;
  const lines = buffer.split('\n');
  buffer = lines.pop() || '';

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const req = JSON.parse(trimmed);
      handleRequest(req);
    } catch { /* 跳过无效 JSON */ }
  }
});

async function handleRequest(req) {
  const id = req.id;
  const method = req.method;

  try {
    switch (method) {
      case 'initialize': {
        // MCP 协议握手
        respond(id, {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {},
          },
          serverInfo: { name: 'memory-service', version: '1.0.0' },
        });
        break;
      }

      case 'notifications/initialized': {
        // 初始化完成，不返回
        break;
      }

      case 'tools/list': {
        respond(id, { tools: TOOLS });
        break;
      }

      case 'tools/call': {
        const toolName = req.params?.name;
        const args = req.params?.arguments || {};

        switch (toolName) {
          case 'memory_search': {
            const results = await search.hybridSearch(args.query, {
              limit: args.limit || 5,
            });
            respond(id, {
              content: [{
                type: 'text',
                text: formatMemories(results),
              }],
            });
            break;
          }

          case 'memory_write': {
            const result = db.upsertMemory({
              type: args.type || 'general',
              content: args.content,
              importance: args.importance || 3,
              explicitScore: 5,
              status: 'permanent',
            });
            respond(id, {
              content: [{
                type: 'text',
                text: result.updated
                  ? `✅ 已更新已有记忆: ${args.content.slice(0, 50)}`
                  : `✅ 已记住: ${args.content.slice(0, 50)}`,
              }],
            });
            break;
          }

          default:
            respond(id, {
              isError: true,
              content: [{ type: 'text', text: `未知工具: ${toolName}` }],
            });
        }
        break;
      }

      default:
        // 未识别的请求，忽略
        break;
    }
  } catch (e) {
    respond(id, {
      isError: true,
      content: [{ type: 'text', text: e.message }],
    });
  }
}

function respond(id, result) {
  const response = JSON.stringify({ jsonrpc: '2.0', id, ...result });
  process.stdout.write(response + '\n');
}

function formatMemories(memories) {
  if (!memories.length) return '暂无相关记忆。';
  return memories.map((m, i) =>
    `[${i + 1}] 类型: ${m.type || 'general'} | 权重: ${(m.weight || 0).toFixed(1)} | ${m.content}`
  ).join('\n\n');
}
