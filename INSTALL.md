# 沈幼楚 完整安装使用指南

---

## 目录

- [环境要求](#环境要求)
- [快速安装（5 分钟）](#快速安装5-分钟)
- [微信接入（cc-connect）](#微信接入cc-connect)
- [项目配置详解](#项目配置详解)
- [日常使用](#日常使用)
- [记忆系统](#记忆系统)
- [后台服务（开机自启）](#后台服务开机自启)
- [备份与恢复](#备份与恢复)
- [模型切换](#模型切换)
- [故障排除](#故障排除)

---

## 环境要求

| 依赖 | 版本 | 安装 |
|------|------|------|
| Node.js | ≥ v18 | [nodejs.org](https://nodejs.org) |
| Python | ≥ v3.10 | 用于 Whisper ASR + Demucs |
| Claude Code CLI | 最新 | `npm install -g @anthropic-ai/claude-code` |
| cc-connect | ≥ v1.4 | `npm install -g cc-connect` |
| Git | 任意 | [git-scm.com](https://git-scm.com) |

Python 依赖（安装后执行）：
```bash
pip install faster-whisper
```

验证环境：

```bash
node --version    # v18+
python --version  # v3.10+
claude --version
cc-connect --version
```

---

## 快速安装（5 分钟）

### 1. 克隆项目

```bash
git clone https://github.com/Misayhuiyi/Claude_emotional.git
cd Claude_emotional
```

### 2. 安装依赖

```bash
npm install
```

### 3. 初始化数据库

```bash
node scripts/init-db.js
```

### 4. 配置模型

编辑 `.claude/settings.local.json`：

```json
{
  "env": {
    "ANTHROPIC_MODEL": "deepseek-v4-flash",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "deepseek-v4-flash",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "deepseek-v4-pro",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "deepseek-v4-pro",
    "ANTHROPIC_REASONING_MODEL": "deepseek-v4-flash"
  },
  "model": "deepseek-v4-flash"
}
```

如果是 Anthropic 官方密钥：

```json
{
  "env": {
    "ANTHROPIC_API_KEY": "sk-ant-你的密钥",
    "ANTHROPIC_MODEL": "claude-sonnet-4-6"
  }
}
```

### 5. 环境变量配置

```bash
cp .env.example .env
# 编辑 .env 填入密钥
```

必填：
- `VISION_API_KEY` — 图片理解（通义千问 Qwen3-VL-Plus）

可选：
- `TTS_API_KEY` — 语音合成（CosyVoice）
- `CITY` — 天气城市（默认广州）

### 6. 数据库迁移

```bash
node scripts/migrate-multimodal.js
```

### 7. 下载 Whisper 模型（ASR 语音转文字）

```bash
set HF_ENDPOINT=https://hf-mirror.com
python -c "from faster_whisper import WhisperModel; WhisperModel('base',device='cpu',compute_type='int8',download_root='whisper/models'); print('done')"
```

### 8. 启动主动推送服务

```bash
# 手动启动
node --max-old-space-size=4096 memory-service/proactive-main.js

# 开机自启
powershell -ExecutionPolicy Bypass -File scripts/install-proactive.ps1
```

### 9. 播种初始记忆（可选）

```bash
node scripts/seed-memory.js
```

### 6. 终端测试

```bash
node memory-service/index.js
```

输入消息测试对话。输入 `/exit` 退出。

---

## 微信接入（cc-connect）

### 1. 安装 cc-connect

```bash
npm install -g cc-connect
```

### 2. 配置 config.toml

编辑项目根目录的 `config.toml`：

```toml
language = "zh"

[log]
level = "info"

[[projects]]
name = "沈幼楚"

[projects.agent]
type = "claudecode"

[projects.agent.options]
work_dir = "e:\\better\\EmotionalAgent"
mode = "default"
append_system_prompt = "每次回复前请先调用 memory_search 工具检索相关记忆。"

[[projects.platforms]]
type = "weixin"

[projects.platforms.options]
# token 通过下一步扫码自动获取
```

### 3. 微信扫码绑定

```bash
cd 项目目录
cc-connect weixin setup --project 沈幼楚
```

终端会显示二维码，用手机微信扫码确认。token 会自动写入 config.toml。

如果已有 token：

```bash
cc-connect weixin bind --project 沈幼楚 --token '你的token'
```

### 4. 启动

```bash
# 前台启动（测试用）
cc-connect

# 后台服务（推荐）
cc-connect daemon install
```

### 5. 验证

用微信给机器人发消息，终端日志会显示消息处理过程。

### 6. 微信内可用命令

```
/model deepseek-v4-flash    # 切换陪伴模型（快速）
/model deepseek-v4-pro      # 切换工作模型（强推理）
/list                        # 查看会话列表
/switch <id>                 # 切换会话
/new                         # 新会话
/cron list                   # 查看定时任务
```

---

## 项目配置详解

### config.toml 完整说明

```toml
language = "zh"

[display]
mode = "quiet"                # 安静模式，减少中间消息
thinking_messages = false     # 不显示思考过程
tool_messages = false         # 不显示工具调用
reply_footer = false          # 不显示模型状态尾巴
show_context_indicator = false # 不显示上下文占比

[log]
level = "info"

[[projects]]
name = "沈幼楚"

[projects.agent]
type = "claudecode"

[projects.agent.options]
work_dir = "项目绝对路径"
mode = "default"
append_system_prompt = "每次回复前请先调用 memory_search 工具检索相关记忆"

[[projects.platforms]]
type = "weixin"

[projects.platforms.options]
token = "扫码获取的token"
base_url = "https://ilinkai.weixin.qq.com"
account_id = "机器人账号"
```

### .claude/settings.local.json 说明

| 字段 | 用途 |
|------|------|
| `model` | 默认模型（flash 日常 / pro 工作） |
| `ANTHROPIC_API_KEY` | Anthropic 官方密钥（可选，不填则用 DeepSeek） |
| `ANTHROPIC_BASE_URL` | 非官方 API 地址（DeepSeek 代理） |
| `ANTHROPIC_DEFAULT_HAIKU_MODEL` | 快速模型 |
| `ANTHROPIC_REASONING_MODEL` | auto-mode 安全审核模型 |

---

## 日常使用

### 微信聊天

配置好 cc-connect 后，直接通过微信给机器人发消息即可。

- 日常聊天 → 自动触发记忆检索和存储
- 说"记住XXX" → 写入永久记忆
- 说"忘掉XXX" → 标记遗忘
- 发 `/checkpoint` → 保存当前情绪位置

### 终端测试

```bash
node memory-service/index.js
```

用于本地测试和调试，不依赖微信。

### 记忆管理面板

```bash
node memory-service/admin-server.js
# 浏览器打开 http://localhost:8765
```

功能：
- 浏览所有记忆（按权重排序）
- 搜索记忆
- 编辑内容、类型、状态、权重
- 标记遗忘
- 查看统计（总记忆、消息数、摘要数）

---

## 记忆系统

### 记忆生命周期

```
用户提到一次 → candidate（暂存，权重 < 10）
再次提到     → working（活跃，10 ≤ 权重 < 20）
反复3次+/明确记住 → permanent（永久，权重 ≥ 20）
长期未出现   → archived（归档）
用户说忘掉   → forgotten（遗忘）
```

### 权重公式

```
weight = importance × 2 + frequency × 1.5 + emotion_score × 2
       + explicit_score × 5 + recency_score + confidence
```

权重由代码保证计算，不依赖模型判断。

### 在聊天中管理记忆

```
用户：记住我最讨厌吃香菜
小克：好，我记住啦 ✓

用户：忘掉吃香菜那件事
小克：已忘掉 ✓

用户：/checkpoint
小克：已保存 checkpoint ✓
```

### 记忆查看

- Web 面板：http://localhost:8765
- 对话中查不到，但 Claude 回复时会自动检索相关记忆

---

## 后台服务（开机自启）

项目包含 3 个 Windows 定时任务，安装后开机自动运行：

| 任务 | 时间 | 功能 |
|------|------|------|
| `cc-connect` | 开机启动 | 微信消息桥接 |
| `shen-yuchu-session-watcher` | 开机启动 | 每 10 秒同步消息到记忆库 |
| `shen-yuchu-proactive` | 开机启动 | 主动推送调度器（天气/资讯/学习/晚安） |
| `shen-yuchu-summary` | 每天 03:00 | 生成昨日对话摘要 |
| `shen-yuchu-maintenance` | 每天 04:00 | 遗忘维护（归档过期记忆） |

安装命令：

```bash
# cc-connect（已含在安装步骤）
cc-connect daemon install

# session-watcher
schtasks //create //tn "shen-yuchu-session-watcher" //tr "node e:\better\EmotionalAgent\memory-service\session-watcher.js" //sc onstart //rl LIMITED //f

# 每日摘要
schtasks //create //tn "shen-yuchu-summary" //tr "cmd /c e:\better\EmotionalAgent\scripts\daily-summary.cmd" //sc daily //st 03:00 //rl LIMITED //f

# 遗忘维护
schtasks //create //tn "shen-yuchu-maintenance" //tr "node -e require('./memory-service/gate').runMaintenance()" //sc daily //st 04:00 //rl LIMITED //f
```

查看服务状态：

```bash
cc-connect daemon status
```

---

## 备份与恢复

### 手动备份

```bash
# SQLite 数据库备份（自动保留 7 天）
node scripts/backup-memory.js

# JSON 导出（可阅读、可迁移）
node scripts/backup-memory.js --json

# 设置保留数量
node scripts/backup-memory.js --cleanup 14
```

备份文件保存在 `data/backups/` 目录。

### 恢复

```bash
# 从备份恢复
cp data/backups/memory-2026-07-01.db data/memory.db
```

---

## 模型切换

### 方案一：切换默认模型

编辑 `.claude/settings.local.json`：

```json
{
  "model": "deepseek-v4-pro"
}
```

### 方案二：切换提供商（DeepSeek → Anthropic）

```json
{
  "env": {
    "ANTHROPIC_API_KEY": "sk-ant-你的密钥",
    "ANTHROPIC_BASE_URL": "",
    "ANTHROPIC_MODEL": "claude-sonnet-4-6"
  }
}
```

### 方案三：微信内临时切换（仅当前会话）

```
/model deepseek-v4-pro
```

### 可用模型

| 模型 | 用途 | 速度 |
|------|------|------|
| `deepseek-v4-flash` | 日常陪伴（默认） | ~1.7s |
| `deepseek-v4` | 标准对话 | ~3s |
| `deepseek-v4-pro` | 工程/工作模式 | ~8s |
| `claude-sonnet-4-6` | Anthropic 官方 | 视网络 |

---

## 故障排除

### 微信消息已发送但未回复

```bash
# 检查 cc-connect 是否运行
cc-connect daemon status

# 检查日志
cc-connect daemon logs -n 50

# 重启
cc-connect daemon restart
```

### claude 命令找不到

```bash
# 检查 claude 是否在 PATH 中
where claude

# 如缺失则重新安装
npm install -g @anthropic-ai/claude-code
```

### 记忆面板无法访问

```bash
# 手动启动
node memory-service/admin-server.js
# 浏览器打开 http://localhost:8765
```

### 模型返回 "model temporarily unavailable"

DeepSeek API 暂时不稳定，等待几分钟后重试，或在 `.claude/settings.local.json` 中加入：

```json
"disableAutoMode": "disable"
```

### 数据库损坏

```bash
# 从备份恢复
cp data/backups/memory-最近日期.db data/memory.db

# 或重新初始化（会清空所有记忆）
node scripts/init-db.js
```

### 如何完全重置

```bash
# 备份旧数据
node scripts/backup-memory.js

# 重建
del data\memory.db
node scripts/init-db.js
```

---

## 主动资讯推送（v3.1 新增）

### 推送时段

| 时段 | 时间 | 内容 |
|------|------|------|
| ☀️ 早安 | 08:30-09:30 | 天气 + 热点 + AI 动态 |
| 🍚 午间 | 11:30-12:30 | 网络热梗/有趣新闻 |
| 🌆 傍晚 | 17:00-19:00 | AI 学习资源/技术文章 |
| 🌙 晚安 | 21:00-22:30 | 轻问候（不发资讯） |

### 控制方式

通过 `features.js` 控制各项开关，或微信内使用 MCP 工具：

```
proactive_status   # 查看当前状态
proactive_pause    # 暂停推送
proactive_trigger  # 手动触发一次
```

### 表情包

聊天时沈幼楚会根据氛围自动发送合适表情包，从网络实时搜索热门图。
你也可以发送表情包给她说"存一下"，她会分析后用 vision_analyze 看懂后保存到本地库。

### 学习督促

每天 22:00 起，如果还没写每日总结会温柔提醒。
傍晚时段会推送 Agent 面试题、大模型八股等学习内容。

### 图片理解

发送图片后，沈幼楚自动调用 Qwen3-VL-Plus 分析内容，基于分析结果回复。

### 语音

发送语音后自动转写为文字（本地 Whisper，免费离线）。
TTS 语音回复需配置 CosyVoice API Key。
