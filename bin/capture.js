#!/usr/bin/env node
'use strict';
// SessionEnd hook：会话结束 → 读 transcript → 一次 LLM 调用提炼"关于用户"的卡片 → 入库。
// 设计成永远 exit 0、永远不阻塞会话。建议在 settings.json 里用 `nohup node capture.js & disown` 后台跑。
const L = require('./lib');

// 防递归：claude -p 内部会再触发 SessionEnd，直接退出
if (process.env.MEBRAIN_NESTED) process.exit(0);

const fs = require('fs');
// 输入：--input <file>（hook 包装器用）或 stdin（直接调用用）
let input = '';
let inputFile = null;
const ai = process.argv.indexOf('--input');
if (ai !== -1 && process.argv[ai + 1]) {
  inputFile = process.argv[ai + 1];
  try { input = fs.readFileSync(inputFile, 'utf8'); } catch {}
} else {
  try { input = fs.readFileSync(0, 'utf8'); } catch {}
}
let hook = {};
try { hook = JSON.parse(input || '{}'); } catch {}

const transcriptPath = hook.transcript_path || hook.transcriptPath;
const cwd = hook.cwd || process.cwd();
const sessionId = hook.session_id || hook.sessionId || 'unknown';

(async function main() {
  try {
    L.ensureDirs();
    if (!transcriptPath) { L.log('capture skip: no transcript_path'); return; }

    // blocklist：cwd 命中关键词就跳过
    const cwdLower = cwd.toLowerCase();
    for (const kw of L.getBlocklist()) {
      if (cwdLower.includes(kw)) { L.log(`capture skip: cwd matched blocklist "${kw}"`); return; }
    }

    const cfg = L.getConfig();
    const text = L.readTranscriptText(transcriptPath, 30000);
    if (text.length < cfg.capture_min_chars) { L.log(`capture skip: transcript too short (${text.length})`); return; }

    const proj = L.projectKey(cwd);
    const existing = L.readAllCards()
      .map(c => `- [${c.type}] ${c.name} :: ${c.description || ''}`).join('\n') || '（目前没有任何卡片）';

    const prompt = [
      '你在帮我维护一个"关于我（这个用户）"的长期记忆库。下面是我刚结束的一次 Claude Code 会话记录。',
      '请从中提炼出"值得长期记住的、关于这个用户本人"的事实，输出 JSON 数组。宁缺毋滥——如果这次会话没有值得记的，输出 []。',
      '',
      '可以记的类型（type 字段，只能用这些）：',
      '- pitfall：用户踩过的坑（在什么场景下、错在哪、正确做法、为什么）',
      '- preference：用户的偏好 / 工作习惯（用户明确表达过的，比如"我习惯用 X 不用 Y"）',
      '- decision：用户做过的决策（决定了什么、为什么、目前还成不成立）',
      '- project：某个项目的背景（不可能从代码/git 直接推出来的那种上下文）',
      '- fact：关于用户本人的事实（角色、技能、处境、在用什么工具）',
      '- reference：用户提到的外部资源（URL / 看板 / 文档）',
      '',
      '不要记：代码结构、git 历史里有的东西、只对这次对话有意义的临时信息、CLAUDE.md 里已经写了的东西。',
      '不要重复下面这些已经存在的卡片（同一个意思就别再提）：',
      existing,
      '',
      '每个 JSON 对象的字段：',
      '  type: 上面六种之一',
      '  name: 3-6 个词的标题',
      '  description: 一句话，将来检索时靠它判断"这条跟当前场景相关吗"，要写得让人一眼能判',
      '  confidence: 1-10 的整数，你对"这条确实值得记且准确"的把握',
      `  scope: "global"（关于用户本人，跨项目）或 "project:${proj}"（只跟当前这个项目有关）`,
      '  body: 卡片正文。pitfall / decision 类请在正文里写清楚 "为什么" 和 "怎么应用"',
      '',
      '只输出 JSON 数组，不要任何解释。',
      '',
      '=== 会话记录开始 ===',
      text,
      '=== 会话记录结束 ===',
    ].join('\n');

    let raw;
    try { raw = L.callClaude(prompt, cfg.model); }
    catch (e) { L.log('capture: claude call failed: ' + e.message); return; }

    let cards;
    try { cards = L.extractJson(raw); } catch (e) { L.log('capture: parse failed: ' + e.message + ' | raw: ' + raw.slice(0, 300)); return; }
    if (!Array.isArray(cards)) cards = [];

    let saved = 0;
    for (const c of cards) {
      if (!c || typeof c !== 'object') continue;
      if (!c.type || !c.name || !c.body) continue;
      if (!L.VALID_TYPES.includes(c.type)) c.type = 'note';
      let conf = parseInt(c.confidence, 10); if (!(conf >= 1 && conf <= 10)) conf = 6;
      // 项目级卡片一律绑到当前目录的 projectKey，保证 inject.js 能按 cwd 找回来
      const scope = (typeof c.scope === 'string' && c.scope.startsWith('project:')) ? ('project:' + proj) : 'global';
      L.writeCard({
        name: String(c.name).slice(0, 80),
        description: String(c.description || '').slice(0, 240),
        type: c.type,
        confidence: conf,
        source: 'inferred',
        origin_session: sessionId,
        scope,
        body: String(c.body),
      }, L.MEMORY_DIR);
      saved++;
    }
    L.log(`capture: session ${sessionId} → ${saved} card(s) saved (${cards.length} proposed)`);
  } catch (e) {
    L.log('capture: unexpected error: ' + (e && e.stack || e));
  } finally {
    if (inputFile) { try { fs.unlinkSync(inputFile); } catch {} }
    process.exit(0);
  }
})();
