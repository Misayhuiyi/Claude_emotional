const { spawn } = require('child_process');
const { Readable } = require('stream');
const config = require('./config');

/**
 * Claude Runner
 *
 * 职责：调用 claude --bare --print
 *
 * 两种使用模式：
 *   A) cc-connect 模式：cc-connect 调用本项目目录的 Claude Code，本项目提供 CLAUDE.md + memory tools
 *   B) 本模块直接调用：用于测试、调试和非 cc-connect 场景
 */

const DEFAULT_TIMEOUT = config.CLAUDE.timeout || 30000;

/**
 * 执行一次 Claude 调用
 *
 * @param {string} context - 拼接好的完整上下文（通过 stdin 传入）
 * @param {Object} options
 * @param {string} options.model - 模型名称（默认 config.MODEL.companion）
 * @param {number} options.timeout - 超时毫秒
 * @param {boolean} options.bare - 是否使用 --bare 模式
 * @returns {Promise<{ success: boolean, response: string, error: string, model: string }>}
 */
function run(context, options = {}) {
  return new Promise((resolve) => {
    const model = options.model || config.MODEL.companion;
    const timeout = options.timeout || DEFAULT_TIMEOUT;
    const useBare = options.bare !== undefined ? options.bare : config.CLAUDE.bareMode;

    const args = ['--print'];
    if (useBare) args.push('--bare');
    args.push('--model', model);

    // 最后的 prompt：让 Claude 按要求回复
    const prompt = '请按照上述身份和规则，用自然、短句的方式回复用户。只输出回复内容，不要加前缀标记。';

    const child = spawn('claude', [...args, prompt], {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: timeout,
      env: { ...process.env },
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    let finished = false;

    const timer = setTimeout(() => {
      if (!finished) {
        finished = true;
        child.kill();
        resolve({
          success: false,
          response: '',
          error: `调用超时（${timeout}ms）`,
          model,
        });
      }
    }, timeout);

    // 写入上下文到 stdin
    const stdinStream = new Readable();
    stdinStream.push(context);
    stdinStream.push(null);
    stdinStream.pipe(child.stdin);

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);

      if (code === 0) {
        const response = stdout.trim();
        resolve({
          success: true,
          response,
          error: '',
          model,
        });
      } else {
        resolve({
          success: false,
          response: '',
          error: stderr || `进程退出，exit code: ${code}`,
          model,
        });
      }
    });

    child.on('error', (err) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);

      resolve({
        success: false,
        response: '',
        error: err.message,
        model,
      });
    });
  });
}

module.exports = { run };
