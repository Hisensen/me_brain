#!/usr/bin/env node
'use strict';
// MeBrain CLI：me save | show | list | forget | why | distill | log | help
const fs = require('fs');
const path = require('path');
const L = require('./lib');

const args = process.argv.slice(2);
const cmd = (args[0] || 'help').toLowerCase();

function parseFlags(arr) {
  const f = {}; const rest = [];
  for (let i = 0; i < arr.length; i++) {
    const a = arr[i];
    if (a === '--') { rest.push(...arr.slice(i + 1)); break; }
    const m = a.match(/^--([a-zA-Z_]+)(?:=(.*))?$/);
    if (m) { f[m[1]] = m[2] !== undefined ? m[2] : (arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[++i] : true); }
    else rest.push(a);
  }
  return { flags: f, rest };
}

function findCard(needle) {
  const all = L.readAllCards();
  needle = String(needle || '').toLowerCase();
  // 先精确匹配 name，再模糊
  return all.find(c => (c.name || '').toLowerCase() === needle)
    || all.find(c => (c.name || '').toLowerCase().includes(needle))
    || all.find(c => path.basename(c._file || '').toLowerCase().includes(needle));
}

function cmdSave() {
  const { flags, rest } = parseFlags(args.slice(1));
  L.ensureDirs();
  let card;
  if (flags.type || flags.name) {
    // 结构化形式（给 cc 调用）
    card = {
      type: flags.type || 'fact',
      name: flags.name || (rest.join(' ').slice(0, 60)) || 'untitled',
      description: flags.desc || flags.description || rest.join(' ').slice(0, 200) || '',
      scope: (typeof flags.scope === 'string' && flags.scope) ? flags.scope : 'global',
      confidence: flags.confidence ? parseInt(flags.confidence, 10) : 8,
      source: 'user-stated',
      body: rest.join(' ').trim() || flags.desc || flags.name || '',
    };
  } else {
    // 随手一句形式（人类用）
    const text = rest.join(' ').trim();
    if (!text) { console.error('用法: me save "随手一句" 或 me save --type X --name Y --desc Z -- 正文'); process.exit(1); }
    card = {
      type: 'note', name: text.slice(0, 60), description: text.slice(0, 200),
      scope: 'global', confidence: 7, source: 'user-stated', body: text,
    };
  }
  const fp = L.writeCard(card, L.MEMORY_DIR);
  console.log(`已记下 [${card.type}] ${card.name}  (${card.scope})`);
  console.log(`  → ${fp}`);
  if (card.type === 'note') console.log('  提示：这是粗卡片，下次 `me distill` 会帮它归类整理。');
}

function cmdShow() {
  const { flags, rest } = parseFlags(args.slice(1));
  const filterType = rest[0] || flags.type;
  let all = L.readAllCards();
  if (filterType) all = all.filter(c => c.type === filterType);
  if (!all.length) { console.log('（空）。还没有任何卡片' + (filterType ? `（type=${filterType}）` : '') + '。'); return; }
  all.sort((a, b) => String(b.last_seen || '').localeCompare(String(a.last_seen || '')));
  console.log(`共 ${all.length} 张卡片：\n`);
  for (const c of all) {
    console.log(`● [${c.type}] ${c.name}   {${c.scope}, conf=${c.confidence}, hits=${c.hit_count}, seen=${c.last_seen}}`);
    if (c.description) console.log(`    ${c.description}`);
  }
  console.log(`\n看某张全文： cat "$(grep -rl 'name: <标题>' ~/.me/memory/)"   或   me why <标题>`);
}

function cmdList() { cmdShow(); }

function cmdForget() {
  const needle = args.slice(1).join(' ').trim();
  if (!needle) { console.error('用法: me forget <名字关键词>'); process.exit(1); }
  const c = findCard(needle);
  if (!c) { console.error(`没找到匹配 "${needle}" 的卡片。先 me show 看看名字。`); process.exit(1); }
  L.moveToArchive(c);
  console.log(`已归档（不是真删，挪到 ~/.me/archive/）：[${c.type}] ${c.name}`);
}

function cmdWhy() {
  const needle = args.slice(1).join(' ').trim();
  if (!needle) { console.error('用法: me why <名字关键词>'); process.exit(1); }
  const c = findCard(needle);
  if (!c) { console.error(`没找到匹配 "${needle}" 的卡片。`); process.exit(1); }
  console.log(`[${c.type}] ${c.name}`);
  console.log(`  文件: ${c._file}`);
  console.log(`  来源: ${c.source}` + (c.origin_session ? `，会话 ${c.origin_session}` : ''));
  console.log(`  创建: ${c.created}  上次命中: ${c.last_seen}  命中次数: ${c.hit_count}  置信度: ${c.confidence}`);
  console.log(`  作用域: ${c.scope}`);
  console.log(`  描述: ${c.description}`);
  console.log(`\n正文:\n${c.body}`);
  if (c.origin_session && c.origin_session !== 'unknown') {
    // 尝试在 ~/.claude/projects/*/<session>.jsonl 找 transcript
    try {
      const projRoot = path.join(L.HOME, '.claude', 'projects');
      for (const d of fs.readdirSync(projRoot)) {
        const cand = path.join(projRoot, d, c.origin_session + '.jsonl');
        if (fs.existsSync(cand)) { console.log(`\n原始会话记录: ${cand}`); break; }
      }
    } catch {}
  }
}

function cmdLog() {
  try { process.stdout.write(fs.readFileSync(L.CAPTURE_LOG, 'utf8')); }
  catch { console.log('（还没有采集日志 ~/.me/.capture.log）'); }
}

function cmdDistill() {
  L.ensureDirs();
  const cfg = L.getConfig();
  const all = L.readAllCards();
  if (all.length < 2) { console.log('卡片太少（<2 张），不用净化。'); return; }
  console.log(`净化中：把 ${all.length} 张卡片交给 ${cfg.model} 做去重/合并/标记过时……（可能要十几秒）`);

  const dump = all.map((c, i) => `[${i}] type=${c.type} scope=${c.scope} conf=${c.confidence} name="${c.name}"\n    desc: ${c.description || ''}\n    body: ${(c.body || '').replace(/\s+/g, ' ').slice(0, 500)}`).join('\n\n');

  const prompt = [
    '下面是一个"关于某用户的长期记忆库"里的所有卡片。请帮我净化：',
    '1. 找出语义重复或高度重叠的卡片，合并成一张（合并后写一张更好的）。',
    '2. 找出明显过时 / 自相矛盾 / 没有长期价值的卡片，标记删除。',
    '3. 给 description 写得不好（太泛、看不出什么时候相关）的卡片重写 description。',
    '4. type 用错的纠正一下（可用：pitfall, preference, decision, project, fact, reference, note）。',
    '',
    '输出一个 JSON 对象：',
    '{',
    '  "keep": [ {"index": <原编号>, "name": "...", "description": "...", "type": "...", "scope": "...", "confidence": <1-10>, "body": "..."}, ... ],   // 保留/修改后的卡片（合并产生的新卡用任意一个被合并的 index 都行，或省略 index）',
    '  "drop": [ <原编号>, ... ],   // 要删掉的卡片编号',
    '  "merged_away": [ <原编号>, ... ]   // 因为被合并而消失的原卡编号',
    '}',
    '只输出 JSON，不要解释。',
    '',
    '=== 卡片清单 ===',
    dump,
  ].join('\n');

  let raw, result;
  try { raw = L.callClaude(prompt, cfg.model); result = L.extractJson(raw); }
  catch (e) { console.error('净化失败：' + e.message); process.exit(1); }

  const drop = new Set([...(result.drop || []), ...(result.merged_away || [])].map(Number));
  // 应用：先把 drop/merged 的归档
  let archived = 0;
  for (const c of all) {
    const idx = all.indexOf(c);
    if (drop.has(idx)) { try { L.moveToArchive(c); archived++; } catch {} }
  }
  // keep：更新已存在的卡片；index 没了的（合并新卡）就新建
  let updated = 0, created = 0;
  for (const k of (result.keep || [])) {
    if (!k || !k.name) continue;
    let target = (typeof k.index === 'number' && all[k.index] && !drop.has(k.index)) ? all[k.index] : null;
    if (target) {
      target.name = k.name; target.description = k.description || target.description;
      if (k.type && L.VALID_TYPES.includes(k.type)) target.type = k.type;
      if (k.scope) target.scope = k.scope;
      if (k.confidence) target.confidence = parseInt(k.confidence, 10) || target.confidence;
      if (k.body) target.body = k.body;
      try { L.updateCardFile(target); updated++; } catch {}
    } else {
      L.writeCard({ name: k.name, description: k.description || '', type: k.type || 'note',
        scope: k.scope || 'global', confidence: parseInt(k.confidence, 10) || 6, source: 'inferred', body: k.body || k.description || '' });
      created++;
    }
  }
  // 老化降权：hit_count=0 且超过 prune_after_days 没动 → 归档
  const cutoff = new Date(Date.now() - cfg.prune_after_days * 86400000).toISOString().slice(0, 10);
  let aged = 0;
  for (const c of L.readAllCards()) {
    if ((+c.hit_count || 0) === 0 && String(c.created || '') < cutoff) { try { L.moveToArchive(c); aged++; } catch {} }
  }
  console.log(`净化完成：合并/删除归档 ${archived} 张，重写 ${updated} 张，新建 ${created} 张，老化归档 ${aged} 张。现存 ${L.readAllCards().length} 张。`);
}

function cmdHelp() {
  console.log(`MeBrain — 你的个人长期记忆库（数据在 ~/.me/）

  me save "随手一句"                          快速记一条（粗卡片，distill 会整理）
  me save --type pitfall --name "..." \\        结构化记一条（cc 会用这个形式）
          --desc "..." --scope global -- 正文
  me show [type]                              看所有卡片（可按 type 过滤：pitfall/preference/decision/project/fact/reference/note）
  me forget <名字关键词>                       归档一条（挪到 ~/.me/archive/，不是真删）
  me why <名字关键词>                          看某条卡片的来源、正文、原始会话
  me distill                                   立即净化：去重/合并/标记过时（调一次 LLM）
  me log                                       看采集日志（~/.me/.capture.log）
  me help                                      本帮助

  自动部分（装了 hook 之后）：
    · 每次 cc 会话结束 → 自动从对话里提炼卡片入库（后台跑，看 me log）
    · 每次 cc 开会话   → 自动注入相关卡片，让 cc 开场就懂你

  调参：编辑 ~/.me/config.json   ｜   不想被吃的目录/词：编辑 ~/.me/blocklist
`);
}

const table = { save: cmdSave, show: cmdShow, list: cmdList, forget: cmdForget, why: cmdWhy, distill: cmdDistill, log: cmdLog, help: cmdHelp };
(table[cmd] || cmdHelp)();
