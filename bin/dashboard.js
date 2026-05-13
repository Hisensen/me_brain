#!/usr/bin/env node
'use strict';
// 生成 ~/.me/dashboard.html —— MeBrain 当前运行状况快照。然后（可选）用 Chrome 打开。
// 用法: node dashboard.js [--open]
const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
const L = require('./lib');

L.ensureDirs();

const PROJECT_ROOT = path.resolve(__dirname, '..');

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function safeRead(p) { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } }
function safeCount(dir) { try { return fs.readdirSync(dir).filter(f => f.endsWith('.md')).length; } catch { return 0; } }

// ---- 收集数据 ----
const cfg = L.getConfig();
const cards = L.readAllCards();
const archivedN = safeCount(L.ARCHIVE_DIR);
const candidateN = safeCount(L.CANDIDATES_DIR);

// hooks 装没装
let settings = {};
try { settings = JSON.parse(safeRead(path.join(L.HOME, '.claude', 'settings.json')) || '{}'); } catch {}
function hookHas(ev, sub) {
  return ((settings.hooks || {})[ev] || []).some(g => (g.hooks || []).some(h => (h.command || '').includes(sub)));
}
const injectInstalled = hookHas('SessionStart', 'mebrain/bin/inject.js');
const captureInstalled = hookHas('SessionEnd', 'mebrain/bin/capture-hook');
const skillInstalled = fs.existsSync(path.join(L.HOME, '.claude', 'skills', 'me', 'SKILL.md'));
const teamBrainHere = hookHas('SessionStart', 'TeamBrain');

// capture 日志（最后 20 行）
const captureLog = safeRead(L.CAPTURE_LOG).trim().split('\n').filter(Boolean).slice(-20);
// CONTEXT.md（cc 现在看到的）
const contextMd = safeRead(path.join(L.ME_DIR, 'CONTEXT.md'));
// blocklist
const blocklist = L.getBlocklist();

// 按 type 统计
const TYPE_ORDER = ['fact', 'preference', 'pitfall', 'decision', 'project', 'reference', 'note'];
const TYPE_LABEL = { fact: '关于用户', preference: '偏好/习惯', pitfall: '踩过的坑', decision: '做过的决策', project: '项目背景', reference: '相关资源', note: '未分类' };
const TYPE_COLOR = { fact: '#7c5cff', preference: '#1f9d55', pitfall: '#d6452c', decision: '#c98a00', project: '#2b7de9', reference: '#0ca0a0', note: '#888' };
const byType = {};
for (const c of cards) (byType[c.type] = byType[c.type] || []).push(c);

const totalHits = cards.reduce((s, c) => s + (+c.hit_count || 0), 0);
const lastCapture = captureLog.length ? captureLog[captureLog.length - 1] : '（还没有自动采集记录）';

// ---- 渲染 HTML ----
const now = new Date();
const cardsSorted = [...cards].sort((a, b) => {
  const t = TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type);
  if (t !== 0) return t;
  return (+b.confidence || 0) - (+a.confidence || 0);
});

function statRow(ok, label, detail) {
  return `<div class="srow"><span class="dot ${ok ? 'on' : 'off'}"></span><b>${esc(label)}</b><span class="muted">${esc(detail || '')}</span></div>`;
}

const cardRows = cardsSorted.map(c => {
  const col = TYPE_COLOR[c.type] || '#888';
  const scopeBadge = (c.scope || '').startsWith('project:')
    ? `<span class="badge proj">${esc(c.scope.slice(8))}</span>` : `<span class="badge glob">全局</span>`;
  return `<details class="card">
    <summary>
      <span class="tpill" style="background:${col}1a;color:${col};border-color:${col}55">${esc(TYPE_LABEL[c.type] || c.type)}</span>
      <span class="cname">${esc(c.name)}</span>
      ${scopeBadge}
      <span class="cmeta">conf ${esc(c.confidence)} · hit ${esc(c.hit_count)} · ${esc(c.last_seen || '')}</span>
    </summary>
    <div class="cdesc">${esc(c.description || '（无描述）')}</div>
    <pre class="cbody">${esc(c.body || '')}</pre>
    <div class="cfile">${esc(c._file ? c._file.replace(L.HOME, '~') : '')}　·　来源 ${esc(c.source || '')}${c.origin_session && c.origin_session !== 'unknown' ? '　·　会话 ' + esc(c.origin_session) : ''}</div>
  </details>`;
}).join('\n') || '<p class="muted">还没有任何卡片。正常用 cc，会话结束后会自动开始沉淀；或者 <code>/me save "随手一句"</code> 手动加一条。</p>';

const barMax = Math.max(1, ...TYPE_ORDER.map(t => (byType[t] || []).length));
const typeBars = TYPE_ORDER.filter(t => (byType[t] || []).length).map(t => {
  const n = (byType[t] || []).length, col = TYPE_COLOR[t];
  return `<div class="bar"><span class="blabel">${esc(TYPE_LABEL[t])}</span><span class="btrack"><span class="bfill" style="width:${(n / barMax * 100).toFixed(1)}%;background:${col}"></span></span><span class="bnum">${n}</span></div>`;
}).join('\n') || '<p class="muted">—</p>';

const html = `<!DOCTYPE html>
<html lang="zh"><head><meta charset="utf-8"><title>MeBrain 运行状况</title>
<style>
  :root{color-scheme:light dark}
  *{box-sizing:border-box}
  body{margin:0;font:14px/1.6 -apple-system,"PingFang SC","Segoe UI",sans-serif;background:#0f1115;color:#e6e7ea}
  a{color:#7aa2ff}
  .wrap{max-width:980px;margin:0 auto;padding:32px 24px 80px}
  h1{font-size:22px;margin:0 0 4px;display:flex;align-items:center;gap:10px}
  h1 .v{font-size:12px;font-weight:600;padding:2px 8px;border-radius:999px;background:#7c5cff22;color:#b3a0ff}
  .sub{color:#8b8f99;margin:0 0 28px;font-size:13px}
  h2{font-size:14px;text-transform:uppercase;letter-spacing:.08em;color:#8b8f99;margin:36px 0 12px;border-bottom:1px solid #232734;padding-bottom:6px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:24px}
  @media(max-width:760px){.grid{grid-template-columns:1fr}}
  .panel{background:#161922;border:1px solid #232734;border-radius:12px;padding:18px}
  .big{display:flex;gap:28px;flex-wrap:wrap;margin-bottom:8px}
  .stat{display:flex;flex-direction:column}
  .stat .n{font-size:30px;font-weight:700;line-height:1}
  .stat .l{font-size:12px;color:#8b8f99;margin-top:4px}
  .srow{display:flex;align-items:center;gap:10px;padding:5px 0}
  .srow b{font-weight:600}
  .muted{color:#8b8f99;font-size:12.5px}
  .dot{width:9px;height:9px;border-radius:50%;flex:none}
  .dot.on{background:#27c46b;box-shadow:0 0 0 3px #27c46b22}
  .dot.off{background:#d6452c;box-shadow:0 0 0 3px #d6452c22}
  .bar{display:flex;align-items:center;gap:10px;margin:6px 0}
  .blabel{width:72px;font-size:12.5px;color:#aab}
  .btrack{flex:1;height:9px;background:#222633;border-radius:5px;overflow:hidden}
  .bfill{display:block;height:100%;border-radius:5px}
  .bnum{width:24px;text-align:right;font-variant-numeric:tabular-nums;color:#cdd}
  details.card{background:#161922;border:1px solid #232734;border-radius:10px;margin:8px 0;padding:0}
  details.card summary{cursor:pointer;list-style:none;padding:11px 14px;display:flex;align-items:center;gap:10px;flex-wrap:wrap}
  details.card summary::-webkit-details-marker{display:none}
  details.card[open]{border-color:#3a4154}
  .tpill{font-size:11px;font-weight:700;padding:2px 8px;border-radius:6px;border:1px solid;flex:none}
  .cname{font-weight:600;flex:1;min-width:140px}
  .badge{font-size:10.5px;padding:1px 7px;border-radius:999px;flex:none}
  .badge.glob{background:#2a2f3c;color:#9aa}
  .badge.proj{background:#2b7de91f;color:#7ab4ff}
  .cmeta{font-size:11.5px;color:#777d8a;font-variant-numeric:tabular-nums}
  .cdesc{padding:0 14px 8px;color:#c7cad2;font-size:13px}
  .cbody{margin:0 14px 8px;padding:10px 12px;background:#0e1016;border:1px solid #232734;border-radius:8px;white-space:pre-wrap;font:12.5px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;color:#cdd2db}
  .cfile{padding:0 14px 11px;font:11px ui-monospace,Menlo,monospace;color:#666c79}
  pre.log,pre.ctx{background:#0e1016;border:1px solid #232734;border-radius:10px;padding:14px;white-space:pre-wrap;font:12px/1.6 ui-monospace,Menlo,monospace;color:#aeb4c0;max-height:340px;overflow:auto}
  code{background:#222633;padding:1px 5px;border-radius:4px;font:12.5px ui-monospace,Menlo,monospace}
  .kv{display:grid;grid-template-columns:auto 1fr;gap:4px 14px;font-size:13px}
  .kv b{color:#aab;font-weight:600}
  .foot{margin-top:40px;color:#777d8a;font-size:12.5px;border-top:1px solid #232734;padding-top:16px}
  .warn{background:#d6452c14;border:1px solid #d6452c44;border-radius:10px;padding:12px 14px;font-size:13px;color:#f0b6a8;margin-top:16px}
</style></head><body><div class="wrap">

<h1>🧠 MeBrain<span class="v">v0.1 · Approach C</span></h1>
<p class="sub">个人长期记忆系统 · 快照生成于 ${esc(now.toLocaleString('zh-CN'))} · 数据目录 <code>~/.me/</code> · 代码 <code>${esc(PROJECT_ROOT)}</code></p>

<div class="grid">
  <div class="panel">
    <h2 style="margin-top:0">总览</h2>
    <div class="big">
      <div class="stat"><span class="n">${cards.length}</span><span class="l">现存卡片</span></div>
      <div class="stat"><span class="n">${totalHits}</span><span class="l">累计被注入次数</span></div>
      <div class="stat"><span class="n">${archivedN}</span><span class="l">已归档</span></div>
      <div class="stat"><span class="n">${candidateN}</span><span class="l">候选池</span></div>
    </div>
    ${typeBars}
  </div>
  <div class="panel">
    <h2 style="margin-top:0">安装状态</h2>
    ${statRow(injectInstalled, 'SessionStart hook（注入）', injectInstalled ? 'inject.js 已挂到 ~/.claude/settings.json' : '未安装 — 跑 node install.js')}
    ${statRow(captureInstalled, 'SessionEnd hook（采集）', captureInstalled ? 'capture-hook.sh 已挂' : '未安装 — 跑 node install.js')}
    ${statRow(skillInstalled, '/me skill', skillInstalled ? '~/.claude/skills/me/' : '未找到')}
    ${statRow(fs.existsSync(L.MEMORY_DIR), '数据目录 ~/.me/', fs.existsSync(L.MEMORY_DIR) ? 'OK' : '不存在')}
    <div class="srow"><span class="dot ${teamBrainHere ? 'on' : 'off'}" style="background:#888;box-shadow:0 0 0 3px #8884"></span><b>同机还有 TeamBrain</b><span class="muted">${teamBrainHere ? '它的 SessionStart hook 也在跑（与 MeBrain 并存）' : '没检测到'}</span></div>
    <div class="muted" style="margin-top:10px">最近一次采集：${esc(lastCapture)}</div>
    ${(injectInstalled && captureInstalled) ? '' : '<div class="warn">⚠️ hook 没装全，或装了还没重启 Claude Code —— 完全退出 cc 再开才生效。</div>'}
  </div>
</div>

<h2>卡片（${cards.length}）</h2>
${cardRows}

<h2>cc 现在看到的（CONTEXT.md 镜像）</h2>
<pre class="ctx">${esc(contextMd || '（还没生成 ~/.me/CONTEXT.md —— SessionStart hook 跑过一次后就会有；或者你刚改完代码还没重启 cc）')}</pre>

<div class="grid">
  <div class="panel">
    <h2 style="margin-top:0">采集日志（近 ${captureLog.length} 条）</h2>
    <pre class="log">${esc(captureLog.join('\n') || '（空）')}</pre>
  </div>
  <div class="panel">
    <h2 style="margin-top:0">配置 & 黑名单</h2>
    <div class="kv">
      <b>model</b><span><code>${esc(cfg.model)}</code> —— 采集/净化用的模型</span>
      <b>inject_max_cards</b><span>${esc(cfg.inject_max_cards)} —— 每次注入多少张</span>
      <b>capture_min_chars</b><span>${esc(cfg.capture_min_chars)} —— 会话短于这个不采集</span>
      <b>prune_after_days</b><span>${esc(cfg.prune_after_days)} —— 多久没命中就老化归档</span>
    </div>
    <div class="muted" style="margin-top:12px">改这些：编辑 <code>~/.me/config.json</code></div>
    <h2 style="font-size:12px;margin:18px 0 8px">blocklist（${blocklist.length} 条）</h2>
    <div class="muted">${blocklist.length ? blocklist.map(esc).join('、') : '（空 —— 没有禁区。编辑 ~/.me/blocklist 添加不想被吃的目录关键词）'}</div>
  </div>
</div>

<div class="foot">
  用法回顾：<code>/me show</code> 看卡片 · <code>/me save "..."</code> 手动记 · <code>/me forget &lt;名字&gt;</code> 删 · <code>/me why &lt;名字&gt;</code> 看来源 · <code>/me distill</code> 净化 · <code>/me log</code> 看采集日志<br>
  这个面板本身是静态快照。重新生成：<code>node ${esc(path.join(PROJECT_ROOT, 'bin', 'dashboard.js'))} --open</code>
</div>

</div></body></html>`;

const outPath = path.join(L.ME_DIR, 'dashboard.html');
fs.writeFileSync(outPath, html);
console.log('已生成 ' + outPath);

if (process.argv.includes('--open')) {
  // 优先 Google Chrome，没有就用默认浏览器
  const tryOpen = (cmd, args) => { try { spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref(); return true; } catch { return false; } };
  let chromePath = null;
  for (const p of ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Google Chrome.app']) {
    if (fs.existsSync(p)) { chromePath = p; break; }
  }
  if (chromePath) {
    if (!tryOpen('open', ['-a', 'Google Chrome', outPath])) tryOpen('open', [outPath]);
    console.log('已用 Chrome 打开。');
  } else {
    tryOpen('open', [outPath]);
    console.log('没找到 Chrome，用默认浏览器打开了。');
  }
}
