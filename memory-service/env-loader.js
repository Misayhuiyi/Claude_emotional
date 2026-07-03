/**
 * Env Loader - 从 .env 文件加载环境变量
 *
 * 用法：在需要读取环境变量的模块中 require 即可，
 *       首次加载时自动读取项目根目录的 .env 文件。
 *
 * .env 文件不应提交到 Git，参见 .gitignore。
 * 配置项列表参见 .env.example。
 */

const fs = require('fs');
const path = require('path');

let loaded = false;

function loadEnv() {
  if (loaded) return;
  loaded = true;

  const envPath = path.resolve(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) {
    console.log('[env] .env 文件不存在，使用默认值或环境变量');
    return;
  }

  const content = fs.readFileSync(envPath, 'utf-8');
  let count = 0;

  for (const line of content.split('\n')) {
    const trimmed = line.trim();

    // 跳过空行和注释
    if (!trimmed || trimmed.startsWith('#')) continue;

    // 解析 KEY=VALUE 或 KEY="VALUE"
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;

    const key = match[1];
    let value = match[2].trim();

    // 去除引号
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    // 只在变量尚未设置时写入（允许系统环境变量覆盖）
    if (!process.env[key]) {
      process.env[key] = value;
      count++;
    }
  }

  if (count > 0) {
    console.log(`[env] 已加载 ${count} 个环境变量`);
  }
}

module.exports = { loadEnv };
