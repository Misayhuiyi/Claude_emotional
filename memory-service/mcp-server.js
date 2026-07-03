/**
 * MCP Server - Memory Service
 *
 * 实现 MCP 协议，让 Claude Code 可以直接调用记忆工具。
 * 通过 stdio JSON-RPC 2.0 与 Claude 通信。
 */

const db = require('./db');
const search = require('./search');
const gate = require('./gate');
const dailyTracker = require('./proactive-service/daily-tracker');
const { features, enable, disable } = require('./features');
const config = require('./config');

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
  {
    name: 'proactive_status',
    description: '查看主动推送当前状态（今日已推送、各开关状态、下次推送时段）',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'proactive_pause',
    description: '暂停或恢复主动推送',
    inputSchema: {
      type: 'object',
      properties: {
        paused: { type: 'boolean', description: 'true=暂停, false=恢复' },
      },
      required: ['paused'],
    },
  },
  {
    name: 'proactive_trigger',
    description: '手动触发一次主动资讯推送（用于测试或阿忆想听时）',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['weather', 'news', 'ai', 'study'], description: '推送类型' },
      },
    },
  },
  {
    name: 'sticker_search',
    description: '按情绪/意图搜索表情包',
    inputSchema: {
      type: 'object',
      properties: {
        emotion: { type: 'string', description: '情绪（sad/happy/tired/lonely/playful）' },
        intent: { type: 'string', description: '意图（comfort/greet/encourage/goodnight/apologize）' },
        scene: { type: 'string', description: '场景（早安/晚安/安慰/鼓励/想你/开心/道歉/撒娇）' },
      },
    },
  },
  {
    name: 'sticker_send',
    description: '发送一张表情包（记录到 sticker_events）',
    inputSchema: {
      type: 'object',
      properties: {
        sticker_id: { type: 'string', description: '表情包 ID' },
        intent: { type: 'string', description: '发送意图' },
      },
      required: ['sticker_id'],
    },
  },
  {
    name: 'vision_analyze',
    description: '分析图片内容（需要配置视觉 API）',
    inputSchema: {
      type: 'object',
      properties: {
        image_path: { type: 'string', description: '图片本地路径' },
        image_url: { type: 'string', description: '图片 URL（优先）' },
      },
    },
  },
  {
    name: 'voice_transcribe',
    description: '将语音转为文字（需要配置 ASR API）',
    inputSchema: {
      type: 'object',
      properties: {
        audio_path: { type: 'string', description: '语音文件路径' },
      },
      required: ['audio_path'],
    },
  },
  {
    name: 'voice_speak',
    description: '将文字转为语音（需要配置 TTS API）',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '要转为语音的文字（不超过100字）' },
      },
      required: ['text'],
    },
  },
  {
    name: 'douyin_digest',
    description: '处理用户分享的抖音内容',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '抖音分享链接' },
        description: { type: 'string', description: '用户自述内容' },
      },
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

          case 'proactive_status': {
            const state = dailyTracker.getState();
            const enabled = features.proactive;
            const activeFeatures = Object.entries(features)
              .filter(([k, v]) => v && k !== 'proactive')
              .map(([k]) => k);

            respond(id, {
              content: [{
                type: 'text',
                text: [
                  `主动推送状态: ${enabled ? '🟢 开启' : '🔴 关闭'}`,
                  `今日已推送: ${state.pushCount}/${config.PROACTIVE.maxDaily} 条`,
                  `上次推送: ${state.lastPushAt ? new Date(state.lastPushAt).toLocaleString() : '无'}`,
                  `勿扰时段: ${config.PROACTIVE.quietHours[0]}-${config.PROACTIVE.quietHours[1]}`,
                  `已开启功能: ${activeFeatures.length ? activeFeatures.join(', ') : '无'}`,
                  `今日总结: ${state.summarySubmitted ? '✅ 已提交' : '❌ 未提交'}`,
                ].join('\n'),
              }],
            });
            break;
          }

          case 'proactive_pause': {
            if (args.paused) {
              disable('proactive');
              respond(id, {
                content: [{ type: 'text', text: '⏸ 主动推送已暂停。发送 proactive_pause paused:false 恢复。' }],
              });
            } else {
              enable('proactive');
              respond(id, {
                content: [{ type: 'text', text: '▶️ 主动推送已恢复。' }],
              });
            }
            break;
          }

          case 'proactive_trigger': {
            const type = args.type || 'weather';
            const scheduler = require('./proactive-service/scheduler');
            enable('proactive');
            // 临时开启对应 feature
            const featureMap = { weather: 'infoWeather', news: 'infoNews', ai: 'infoAI', study: 'studyPush' };
            if (featureMap[type]) enable(featureMap[type]);

            await scheduler.manualTrigger(type);

            respond(id, {
              content: [{
                type: 'text',
                text: `✅ 已手动触发推送 (${type})，请在微信中查看结果。`,
              }],
            });
            break;
          }

          case 'sticker_search': {
            const stickerService = require('./proactive-service/sticker-service');
            let results;
            if (args.scene) {
              const s = stickerService.suggestForScene(args.scene);
              results = s ? [s] : [];
            } else {
              results = stickerService.searchStickers({
                emotion: args.emotion,
                intent: args.intent,
              });
            }
            respond(id, {
              content: [{
                type: 'text',
                text: results.length > 0
                  ? results.map(s => `[${s.id}] ${s.tags.join(', ')} (${s.category})`).join('\n')
                  : '未找到匹配的表情包。',
              }],
            });
            break;
          }

          case 'sticker_send': {
            try {
              const database = db.getDb();
              const sid = 'st_' + Date.now().toString(36);
              database.prepare(`
                INSERT INTO sticker_events (id, sticker_id, intent, sent, reason, created_at)
                VALUES (?, ?, ?, 1, ?, datetime('now'))
              `).run(sid, args.sticker_id, args.intent || '', 'MCP 调用');
              respond(id, {
                content: [{ type: 'text', text: `✅ 表情包 ${args.sticker_id} 已发送。` }],
              });
            } catch (e) {
              respond(id, {
                content: [{ type: 'text', text: `表情包已记录（发送可能受限）: ${args.sticker_id}` }],
              });
            }
            break;
          }

          case 'vision_analyze': {
            const vision = require('./proactive-service/vision-service');
            const result = await vision.analyzeImage(args.image_path, args.image_url);
            if (result.fallback) {
              respond(id, {
                content: [{ type: 'text', text: result.message || '视觉分析暂不可用，请配置视觉 API。' }],
              });
            } else {
              respond(id, {
                content: [{ type: 'text', text: `📷 图片分析结果：${result.summary}` }],
              });
            }
            break;
          }

          case 'voice_transcribe': {
            const voice = require('./proactive-service/voice-service');
            const result = await voice.transcribe(args.audio_path);
            if (result.fallback) {
              respond(id, {
                content: [{ type: 'text', text: result.message || '语音转文字暂不可用，请配置 ASR API。' }],
              });
            } else {
              respond(id, {
                content: [{ type: 'text', text: `🎤 转写结果：${result.transcript}` }],
              });
            }
            break;
          }

          case 'voice_speak': {
            const voice = require('./proactive-service/voice-service');
            const result = await voice.speak(args.text);
            if (result.fallback || !result.audioPath) {
              respond(id, {
                content: [{ type: 'text', text: '语音合成暂不可用，请配置 TTS API。将使用文字回复。' }],
              });
            } else {
              respond(id, {
                content: [{ type: 'text', text: `🔊 语音已生成: ${result.audioPath}` }],
              });
            }
            break;
          }

          case 'douyin_digest': {
            const douyin = require('./proactive-service/douyin-digest');
            const item = await douyin.processDouyinLink(args.url || '', args.description || '');
            respond(id, {
              content: [{
                type: 'text',
                text: `📱 已记录抖音内容: ${item.summary.slice(0, 100)}`,
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
