#!/usr/bin/env node
'use strict';
// 把 MeBrain 的三个 hook 装进 ~/.claude/settings.json（幂等，先备份），
// 顺便把 /me skill 部署到 ~/.claude/skills/me/。
// 卸载：node uninstall.js
const fs = require('fs');
const path = require('path');
const os = require('os');

const SETTINGS = path.join(os.homedir(), '.claude', 'settings.json');
const BIN = path.join(__dirname, 'bin');
const SKILL_SRC = path.join(__dirname, 'skills', 'me', 'SKILL.md');
const SKILL_DST_DIR = path.join(os.homedir(), '.claude', 'skills', 'me');
const SKILL_DST = path.join(SKILL_DST_DIR, 'SKILL.md');
const injectCmd = `node ${path.join(BIN, 'inject.js')}`;
// capture-hook.sh：先前台读完 stdin 落临时文件，再后台跑 capture.js（后台进程 stdin 会被 shell 顶成 /dev/null）
const captureCmd = `sh ${path.join(BIN, 'capture-hook.sh')}`;
// quick-todo.js：UserPromptSubmit 实时口令识别，前台同步
const quickTodoCmd = `node ${path.join(BIN, 'quick-todo.js')}`;

function load() {
  const raw = fs.readFileSync(SETTINGS, 'utf8');
  return JSON.parse(raw);
}
function has(arr, cmdSubstr) {
  return (arr || []).some(group => (group.hooks || []).some(h => (h.command || '').includes(cmdSubstr)));
}

const s = load();
s.hooks = s.hooks || {};
s.hooks.SessionStart = s.hooks.SessionStart || [];
s.hooks.SessionEnd = s.hooks.SessionEnd || [];
s.hooks.UserPromptSubmit = s.hooks.UserPromptSubmit || [];

let changed = false;
if (!has(s.hooks.SessionStart, 'mebrain/bin/inject.js')) {
  s.hooks.SessionStart.push({ matcher: '', hooks: [{ type: 'command', command: injectCmd, timeout: 10 }] });
  changed = true;
  console.log('+ SessionStart → inject.js');
} else console.log('= SessionStart hook 已存在，跳过');

if (!has(s.hooks.SessionEnd, 'mebrain/bin/capture-hook')) {
  s.hooks.SessionEnd.push({ matcher: '', hooks: [{ type: 'command', command: captureCmd, timeout: 5 }] });
  changed = true;
  console.log('+ SessionEnd → capture.js（后台跑）');
} else console.log('= SessionEnd hook 已存在，跳过');

if (!has(s.hooks.UserPromptSubmit, 'mebrain/bin/quick-todo.js')) {
  s.hooks.UserPromptSubmit.push({ matcher: '', hooks: [{ type: 'command', command: quickTodoCmd, timeout: 5 }] });
  changed = true;
  console.log('+ UserPromptSubmit → quick-todo.js（实时口令识别）');
} else console.log('= UserPromptSubmit hook 已存在，跳过');

// 部署 /me skill 文件（每次都覆盖，确保是最新的）
try {
  if (fs.existsSync(SKILL_SRC)) {
    fs.mkdirSync(SKILL_DST_DIR, { recursive: true });
    const before = fs.existsSync(SKILL_DST) ? fs.readFileSync(SKILL_DST, 'utf8') : '';
    const after = fs.readFileSync(SKILL_SRC, 'utf8');
    if (before !== after) {
      fs.writeFileSync(SKILL_DST, after);
      console.log(`+ skill 已部署 → ${SKILL_DST}`);
    } else {
      console.log('= skill 已是最新，跳过');
    }
  }
} catch (e) {
  console.error('! skill 部署失败：' + e.message);
}

if (!changed) { console.log('hook 没有改动。'); process.exit(0); }

const backup = SETTINGS + '.bak-mebrain-' + new Date().toISOString().replace(/[:.]/g, '-');
fs.copyFileSync(SETTINGS, backup);
fs.writeFileSync(SETTINGS, JSON.stringify(s, null, 2) + '\n');
console.log(`\n已写入 ${SETTINGS}（备份: ${backup}）`);
console.log('重启 Claude Code（完全退出再开）后生效。');
