# 小克安装使用说明

## 目录

1. [环境要求](#1-环境要求)
2. [快速开始](#2-快速开始)
3. [项目结构](#3-项目结构)
4. [日常使用](#4-日常使用)
5. [记忆管理](#5-记忆管理)
6. [微信接入](#6-微信接入)
7. [命令参考](#7-命令参考)
8. [备份与恢复](#8-备份与恢复)
9. [模型切换](#9-模型切换)
10. [常见问题](#10-常见问题)

---

## 1. 环境要求

| 依赖 | 最低版本 | 安装方式 |
|------|----------|----------|
| Node.js | v18+ | [nodejs.org](https://nodejs.org) |
| Claude Code CLI | 最新版 | `npm install -g @anthropic-ai/claude-code` |
| Git Bash | 任意版本 | 随 Git for Windows 安装 |
| cc-connect | v1.4+ | `npm install -g cc-connect`（微信接入需要） |

### 验证环境

```bash
node --version    # ≥ v18
claude --version  # Claude Code 已安装
```

---

## 2. 快速开始

```bash
# 1. 进入项目目录
cd /e/better/EmotionalAgent

# 2. 安装依赖
npm install

# 3. 初始化数据库
node scripts/init-db.js

# 4. 启动本地测试
node memory-service/index.js
```

在终端直接和小克对话，输入 `/exit` 退出。

### 首次对话示例

```
你：你好
小克：你好呀，我是小克 😊

你：我叫小明
小克：小明你好！

你：帮我记住，我不喜欢被说教
小克：记住了 ✓
```

---

## 3. 项目结构

```
emotional-agent/
├── CLAUDE.md                  # 小克行为规则（先读这个）
├── identity_core.md           # 稳定人格定义
├── runtime_brief.md           # 每轮必读摘要（自动生成）
├── current_state.md           # 当前状态（自动更新）
├── checkpoint.md              # 手动交接快照
│
├── data/
│   ├── memory.db              # SQLite 长期记忆主库 ★
│   ├── backups/               # 自动备份
│   └── vectors.db             # 向量索引
│
├── memory-service/            # 核心引擎
│   ├── index.js               # 主入口
│   ├── db.js                  # 数据库读写
│   ├── search.js              # 混合检索
│   ├── gate.js                # 记忆权重
│   ├── summarize.js           # 自动摘要
│   ├── claude-runner.js       # Claude CLI 调用
│   └── context-manager.js     # 上下文拼接
│
├── scripts/
│   ├── init-db.js             # 初始化数据库
│   ├── seed-memory.js         # 播种测试记忆
│   ├── backup-memory.js       # 备份工具
│   └── import-legacy-keke.js  # 旧小克迁移
│
├── .claude/
│   ├── settings.local.json    # 项目模型配置
│   ├── commands/              # 自定义命令 ★
│   └── agents/                # 子 Agent 定义
│
└── config.toml                # cc-connect 配置
```

---

## 4. 日常使用

### 4.1 终端测试模式

```bash
node memory-service/index.js
```

每次输入一行，小克回复一行。对话历史保留在内存中。

### 4.2 关键特性

| 特性 | 说明 |
|------|------|
| 情感承接 | 先接情绪再说事，不说教 |
| 模式切换 | 检测到技术请求自动切换专业模式 |
| 长期记忆 | 反复提到的事自动沉淀 |
| 上下文压缩 | token 超过 6000 自动压缩历史 |
| 热记忆 | 每次回复前自动读取身份/状态/规则 |

### 4.3 记忆生命周期

```
用户提过一次  →  candidate（暂存）
再次提到      →  working（活跃）
反复提到/明确记 →  permanent（永久）
长期未提      →  archived（归档）
用户说忘掉    →  forgotten（遗忘）
```

---

## 5. 记忆管理

### 5.1 Web 管理面板

```bash
node memory-service/admin-server.js
# 打开 http://localhost:8765
```

面板功能：
- 查看/搜索所有记忆
- 编辑记忆内容和类型
- 调整权重和状态
- 标记遗忘
- 查看统计和摘要

### 5.2 对话中管理

```
用户：/remember 我最受不了别人居高临下对我说话
小克：已记住 ✓

用户：/forget 说教
小克：找到 2 条相关记忆，确认遗忘？[1] 用户不喜欢被说教 [2] ... 

用户：/checkpoint
小克：已保存 checkpoint ✓
```

---

## 6. 微信接入

### 6.1 安装 cc-connect

```bash
npm install -g cc-connect
```

### 6.2 配置与启动

```bash
cd /e/better/EmotionalAgent

# 微信扫码绑定
cc-connect weixin setup --project 小克
# 终端会显示二维码，用手机微信扫码确认

# 启动
cc-connect
```

### 6.3 验证

手机微信给小克发一条消息，观察终端日志是否收到回复。

### 6.4 cc-connect 常用命令

```bash
cc-connect                          # 启动
cc-connect daemon install           # 安装为系统服务（开机自启）
cc-connect daemon start             # 启动服务
cc-connect daemon stop              # 停止服务
cc-connect --config config.toml     # 指定配置启动
```

### 6.5 微信内命令

```
/model deepseek-v4-flash       # 切换模型
/model deepseek-v4-pro         # 切强模型（工程任务）
/list                           # 查看会话
/switch <会话名>                 # 切换会话
/new                           # 新会话
/cron list                      # 查看定时任务
```

---

## 7. 命令参考

| 命令 | 功能 | 示例 |
|------|------|------|
| `/remember` | 写入永久记忆 | `/remember 小明讨厌被说教` |
| `/forget` | 遗忘记忆 | `/forget 说教` |
| `/checkpoint` | 保存情绪快照 | `/checkpoint` |
| `/summarize` | 生成摘要 | `/summarize` 或 `/summarize weekly` |
| `/memory-audit` | 记忆健康检查 | `/memory-audit` |
| `/import-legacy-keke` | 导入旧小克 | `/import-legacy-keke` |

---

## 8. 备份与恢复

### 8.1 备份

```bash
# SQLite 备份（自动清理旧备份，保留 7 天）
node scripts/backup-memory.js

# JSON 导出（可迁移、可人工阅读）
node scripts/backup-memory.js --json
cat data/backups/export-*.json

# 清理旧备份（保留最近 N 个）
node scripts/backup-memory.js --cleanup 14
```

### 8.2 恢复

```bash
# 从 SQLite 备份恢复
cp data/backups/memory-YYYY-MM-DD.db data/memory.db
```

### 8.3 定时备份（cc-connect cron）

```bash
# 在 cc-connect 中配置每日备份
cc-connect cron add "0 3 * * *" "cd /e/better/EmotionalAgent && node scripts/backup-memory.js"
```

---

## 9. 模型切换

### 9.1 配置文件方式

编辑 `.claude/settings.local.json`：

```json
{
  "model": "deepseek-v4-flash",
  "env": {
    "ANTHROPIC_MODEL": "deepseek-v4-flash",
    "ANTHROPIC_BASE_URL": "https://api.deepseek.com/anthropic"
  }
}
```

### 9.2 可用模型

| 模型名 | 用途 | 延迟 |
|--------|------|------|
| `deepseek-v4-flash` | 日常陪伴（默认） | ~1.7s |
| `deepseek-v4` | 一般对话 | ~3s |
| `deepseek-v4-pro` | 工程分析 | ~8s |

### 9.3 切换到 Anthropic 官方

```json
{
  "env": {
    "ANTHROPIC_API_KEY": "sk-ant-你的密钥",
    "ANTHROPIC_MODEL": "claude-sonnet-4-6"
  }
}
```

---

## 10. 常见问题

### Q: Claude Code 提示 `model temporarily unavailable`

DeepSeek API 暂时不稳定。等待几分钟后重试。或在 `.claude/settings.local.json` 中添加 `"disableAutoMode": "disable"` 跳过安全审核。

### Q: cc-connect 扫码后没反应

1. 确认 `config.toml` 中的 `work_dir` 路径正确
2. 检查微信是否是最新版
3. 试用 `cc-connect weixin new` 重新获取二维码

### Q: 记忆库突然变空

检查 `data/memory.db` 是否存在。如果丢失，从备份恢复：

```bash
cp data/backups/memory-*.db data/memory.db
```

### Q: 如何迁移旧小克

```bash
# 1. 在旧窗口让 Claude 生成交接包
# 2. 保存为 handoff.md

# 3. 导入
node scripts/import-legacy-keke.js handoff.md

# 4. 检查
cat identity_core.md
# 打开 http://localhost:8765 审核记忆
```

### Q: 回复太长怎么办

在 CLAUDE.md 中已配置陪伴模式 2-5 句限制。如果仍然过长，可以在对话中说"回短一点"。

### Q: 怎么完全重置

```bash
# 备份
node scripts/backup-memory.js

# 重建
rm data/memory.db
node scripts/init-db.js
node scripts/seed-memory.js  # 播种最基础的测试记忆
```
