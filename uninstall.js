#!/usr/bin/env node
'use strict';
// 从 ~/.claude/settings.json 摘掉 MeBrain 的两个 hook（先备份）。数据 ~/.me/ 不动。
const fs = require('fs');
const path = require('path');
const os = require('os');

const SETTINGS = path.join(os.homedir(), '.claude', 'settings.json');
const s = JSON.parse(fs.readFileSync(SETTINGS, 'utf8'));
let changed = false;

for (const ev of ['SessionStart', 'SessionEnd', 'UserPromptSubmit']) {
  if (!s.hooks || !s.hooks[ev]) continue;
  const before = s.hooks[ev].length;
  s.hooks[ev] = s.hooks[ev].filter(group => {
    group.hooks = (group.hooks || []).filter(h => !(h.command || '').includes('mebrain/bin/'));
    return group.hooks.length > 0;
  });
  if (s.hooks[ev].length !== before) changed = true;
}

if (!changed) { console.log('没找到 MeBrain 的 hook，无需改动。'); process.exit(0); }
const backup = SETTINGS + '.bak-mebrain-uninstall-' + new Date().toISOString().replace(/[:.]/g, '-');
fs.copyFileSync(SETTINGS, backup);
fs.writeFileSync(SETTINGS, JSON.stringify(s, null, 2) + '\n');
console.log(`已摘掉 MeBrain hook（备份: ${backup}）。数据 ~/.me/ 保留。重启 cc 生效。`);
