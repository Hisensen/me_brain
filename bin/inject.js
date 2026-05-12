#!/usr/bin/env node
'use strict';
// SessionStart hook：开会话 → 挑最相关的卡片 → 打印到 stdout（会被注入进会话上下文）。
// 必须快：纯文件读，不调 LLM。永远 exit 0。
const fs = require('fs');
const L = require('./lib');

if (process.env.MEBRAIN_NESTED) process.exit(0);

let input = '';
try { input = fs.readFileSync(0, 'utf8'); } catch {}
let hook = {};
try { hook = JSON.parse(input || '{}'); } catch {}
const cwd = hook.cwd || process.cwd();

try {
  L.ensureDirs();
  const cfg = L.getConfig();
  const proj = L.projectKey(cwd);
  const all = L.readAllCards();

  // 作用域过滤：全局 + 当前项目
  const relevant = all.filter(c => c.scope === 'global' || c.scope === 'project:' + proj);
  if (relevant.length === 0) process.exit(0);

  // 排序：先 project 专属，再 confidence 高，再 last_seen 新
  relevant.sort((a, b) => {
    const ap = a.scope.startsWith('project:') ? 1 : 0, bp = b.scope.startsWith('project:') ? 1 : 0;
    if (ap !== bp) return bp - ap;
    const ac = +a.confidence || 0, bc = +b.confidence || 0;
    if (ac !== bc) return bc - ac;
    return String(b.last_seen || '').localeCompare(String(a.last_seen || ''));
  });

  const picked = relevant.slice(0, cfg.inject_max_cards);

  // 分组渲染
  const order = ['fact', 'preference', 'pitfall', 'decision', 'project', 'reference', 'note'];
  const label = { fact: '关于用户', preference: '偏好/习惯', pitfall: '踩过的坑', decision: '做过的决策', project: '项目背景', reference: '相关资源', note: '其它' };
  const byType = {};
  for (const c of picked) (byType[c.type] = byType[c.type] || []).push(c);

  let out = `# MeBrain — 关于用户的长期记忆（自动注入，项目: ${proj}）\n`;
  out += `（这些是从过往会话里沉淀下来的、关于这个用户本人的信息。把它们当作背景上下文。不准确的地方用户会用 \`/me forget <名字>\` 删掉。）\n`;
  for (const t of order) {
    if (!byType[t] || !byType[t].length) continue;
    out += `\n## ${label[t] || t}\n`;
    for (const c of byType[t]) {
      const scopeTag = c.scope && c.scope.startsWith('project:') ? ' _(本项目)_' : '';
      out += `- **${c.name}**${scopeTag} — ${c.description || ''}\n`;
      // pitfall/decision 把正文也带上一点
      if ((t === 'pitfall' || t === 'decision') && c.body) {
        const b = c.body.replace(/\s+/g, ' ').trim();
        out += `  ${b.length > 300 ? b.slice(0, 300) + '…' : b}\n`;
      }
    }
  }
  out += `\n---\nMeBrain 用法：当对话中出现关于用户本人的、值得长期记住的信息（一个偏好 / 一个坑 / 一个决策 / 一个项目背景 / 一个关于用户的事实），可以问一句"要我把这个记下来吗？"，用户确认后运行：\n` +
    `\`node ${__dirname}/me.js save --type <pitfall|preference|decision|project|fact|reference> --name "<标题>" --desc "<一句话描述>" --scope <global|project:${proj}> -- <正文>\`\n` +
    `用户也可以直接 \`/me show\` 看全部、\`/me save "随手一句"\`、\`/me forget <名字>\`、\`/me distill\`（净化）。\n`;

  process.stdout.write(out);

  // 记一笔命中：bump last_seen / hit_count
  const t = L.today();
  for (const c of picked) {
    c.last_seen = t;
    c.hit_count = (+c.hit_count || 0) + 1;
    try { L.updateCardFile(c); } catch {}
  }
} catch (e) {
  try { L.log('inject error: ' + (e && e.stack || e)); } catch {}
}
process.exit(0);
