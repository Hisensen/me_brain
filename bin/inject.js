#!/usr/bin/env node
'use strict';
// SessionStart hook：开会话 → 挑最相关的卡片 → 打印到 stdout（会被注入进会话上下文），
// 同时把这份"给 cc 的简报"写到 ~/.me/CONTEXT.md（你随时能打开看 cc 被告知了啥）。
// 必须快：纯文件读，不调 LLM。永远 exit 0。
const fs = require('fs');
const path = require('path');
const L = require('./lib');
const CONTEXT_FILE = path.join(L.ME_DIR, 'CONTEXT.md');

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

  // 把活跃 TODO 单拎出来（status=pending 的 todo 卡）
  const activeTodos = relevant.filter(c => c.type === 'todo' && (c.status || 'pending') === 'pending');
  // 其余知识卡片
  const knowledge = relevant.filter(c => c.type !== 'todo');

  if (relevant.length === 0) process.exit(0);

  // 排序：先 project 专属，再 confidence 高，再 last_seen 新
  knowledge.sort((a, b) => {
    const ap = a.scope.startsWith('project:') ? 1 : 0, bp = b.scope.startsWith('project:') ? 1 : 0;
    if (ap !== bp) return bp - ap;
    const ac = +a.confidence || 0, bc = +b.confidence || 0;
    if (ac !== bc) return bc - ac;
    return String(b.last_seen || '').localeCompare(String(a.last_seen || ''));
  });
  // 活跃 TODO：最新的在前
  activeTodos.sort((a, b) => String(b.created || '').localeCompare(String(a.created || '')));

  const picked = knowledge.slice(0, cfg.inject_max_cards);

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
  // 活跃 TODO 段（v0.2 新加）
  if (activeTodos.length > 0) {
    out += `\n## 📋 活跃 TODO（${activeTodos.length} 条 pending）\n`;
    out += `（这些是用户自己立的待办，做完会消失。优先关注、做完时主动确认。）\n`;
    for (const c of activeTodos) {
      const ageDays = Math.max(0, Math.floor((Date.now() - new Date(c.created || L.today()).getTime()) / 86400000));
      const ageTag = ageDays === 0 ? ' _(今天)_' : ageDays === 1 ? ' _(昨天)_' : ` _(${ageDays} 天前)_`;
      out += `- □ **${c.name}**${ageTag}\n`;
      if (c.body && c.body !== c.name) {
        const b = c.body.replace(/\s+/g, ' ').trim();
        if (b.length > c.name.length + 5) out += `  ${b.length > 200 ? b.slice(0, 200) + '…' : b}\n`;
      }
    }
    out += `\n**TODO 行为指南**：\n`;
    out += `- 若用户在对话中提到上述某条 TODO 的目标动作疑似已完成（如"X 改完了"、"刚 commit 了 Y"、"OBS 镜像关了"），**主动用一句话问一次**："那条 \`<TODO 名>\` 的 TODO 是这个完成了吗？" 用户确认后运行 \`node ${__dirname}/me.js done "<关键词>"\`。\n`;
    out += `- 每条 TODO 在同一会话里最多问一次，被否决就别再问，等下次会话再说。\n`;
    out += `- 当前消息里没有相关线索时，不要主动提 TODO，安静干活就行。\n`;
  }

  out += `\n---\nMeBrain 用法：当对话中出现关于用户本人的、值得长期记住的信息（一个偏好 / 一个坑 / 一个决策 / 一个项目背景 / 一个关于用户的事实），可以问一句"要我把这个记下来吗？"，用户确认后运行：\n` +
    `\`node ${__dirname}/me.js save --type <pitfall|preference|decision|project|fact|reference> --name "<标题>" --desc "<一句话描述>" --scope <global|project:${proj}> -- <正文>\`\n` +
    `用户也可以直接 \`/me show\` 看全部、\`/me save "随手一句"\`、\`/me forget <名字>\`、\`/me distill\`（净化）。\n` +
    `**实时立 TODO**：用户消息开头说"提醒我 X / 记一下 X / 待办：X" → UserPromptSubmit hook 自动立 todo 卡（cc 无需介入）；用户也可以直接 \`/me todo "X"\`、\`/me todo list\`、\`/me done <关键词>\`。\n`;

  process.stdout.write(out);

  // 同时落一份文件镜像：~/.me/CONTEXT.md —— 随时能打开看 cc 被告知了啥
  try {
    const stamp = `<!-- 这是 MeBrain 每次 cc 开会话时自动生成的"给 cc 的简报"快照。每次开会话会被覆盖。\n     最后更新：${new Date().toISOString()}  ｜  当时项目：${proj}  ｜  注入：${picked.length} 知识卡 + ${activeTodos.length} 活跃 TODO -->\n\n`;
    fs.writeFileSync(CONTEXT_FILE, stamp + out);
  } catch {}

  // 记一笔命中：bump last_seen / hit_count（todo 也算，便于追踪它被注入了几次）
  const t = L.today();
  for (const c of [...picked, ...activeTodos]) {
    c.last_seen = t;
    c.hit_count = (+c.hit_count || 0) + 1;
    try { L.updateCardFile(c); } catch {}
  }
} catch (e) {
  try { L.log('inject error: ' + (e && e.stack || e)); } catch {}
}
process.exit(0);
