#!/usr/bin/env node
'use strict';
// UserPromptSubmit hook：实时扫描用户刚提交的消息，命中触发词（提醒我 / 记一下 / 待办：/ TODO:）
// 就立即建一张 todo 卡（status=pending），并往 stdout 写一段 hook 反馈，让 cc 在回复时确认。
// 设计：永远 exit 0、永不阻塞。
const fs = require('fs');
const L = require('./lib');

if (process.env.MEBRAIN_NESTED) process.exit(0);

let input = '';
try { input = fs.readFileSync(0, 'utf8'); } catch {}
let hook = {};
try { hook = JSON.parse(input || '{}'); } catch {}

const prompt = (hook.prompt || '').toString();
const cwd = hook.cwd || process.cwd();
const sessionId = hook.session_id || hook.sessionId || 'unknown';

// 触发模式：只在"行首"匹配，避免把"我提醒你"、"等会儿要提醒我自己"误识别
const TRIGGERS = [
  /^\s*提醒我(?:一下)?[，,：:\s]+(.{2,}?)\s*$/,
  /^\s*记一下[，,：:\s]+(.{2,}?)\s*$/,
  /^\s*记下[，,：:\s]+(.{2,}?)\s*$/,
  /^\s*待办[：:]\s*(.{2,}?)\s*$/,
  /^\s*todo[：:\s]+(.{2,}?)\s*$/i,
];

const created = [];
try {
  L.ensureDirs();

  // blocklist：cwd 命中关键词就跳过（跟 capture.js 一致）
  const cwdLower = cwd.toLowerCase();
  for (const kw of L.getBlocklist()) {
    if (cwdLower.includes(kw)) process.exit(0);
  }

  const lines = prompt.split(/\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.length > 240) continue;   // 太长肯定不是简单提醒
    for (const re of TRIGGERS) {
      const m = line.match(re);
      if (!m || !m[1]) continue;
      const content = m[1].trim().replace(/[。．\.！\!]+$/, '');
      if (content.length < 2) break;
      // 三人称指代往往是叙述，不是给系统的指令
      if (/^(他|她|你|您|TA|ta)/.test(content)) break;

      L.writeCard({
        type: 'todo',
        name: content.slice(0, 60),
        description: content.slice(0, 200),
        scope: 'global',
        confidence: 9,
        source: 'quick-keyword',
        origin_session: sessionId,
        status: 'pending',
        body: content,
      }, L.MEMORY_DIR);
      created.push(content);
      L.log(`quick-todo: created from "${line.slice(0, 80)}" → "${content.slice(0, 80)}"`);
      break;   // 一行只立一条
    }
  }
} catch (e) {
  try { L.log('quick-todo error: ' + (e && e.stack || e)); } catch {}
}

// 立了 TODO → 输出一段 hook 反馈，让 cc 在回复用户时简短确认
if (created.length > 0) {
  const list = created.map(t => `"${t}"`).join('、');
  const tip = created.length === 1
    ? `[MeBrain] 已识别提醒触发词，实时立了一条 TODO：${list}。请在正常回复用户之前先用一行简短确认（如 "✓ 已立 TODO：${created[0]}"），然后再处理其它内容。完成后用户可以说"我做完了 ${created[0].slice(0, 20)}…"，或运行 /me done ${created[0].slice(0, 20)}。`
    : `[MeBrain] 已识别提醒触发词，实时立了 ${created.length} 条 TODO：${list}。请在正常回复用户之前先列出来简短确认。`;
  process.stdout.write(tip + '\n');
}

process.exit(0);
