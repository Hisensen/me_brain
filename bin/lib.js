'use strict';
// MeBrain 共享库：路径、卡片读写、frontmatter、调用 claude。零依赖。
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync, execSync } = require('child_process');

const HOME = os.homedir();
const ME_DIR = path.join(HOME, '.me');
const MEMORY_DIR = path.join(ME_DIR, 'memory');
const CANDIDATES_DIR = path.join(ME_DIR, 'candidates');
const ARCHIVE_DIR = path.join(ME_DIR, 'archive');
const BLOCKLIST_FILE = path.join(ME_DIR, 'blocklist');
const CONFIG_FILE = path.join(ME_DIR, 'config.json');
const CAPTURE_LOG = path.join(ME_DIR, '.capture.log');

const VALID_TYPES = ['pitfall', 'preference', 'decision', 'project', 'fact', 'reference', 'note', 'todo'];
const DEFAULT_CONFIG = {
  model: 'haiku',          // 采集/净化用的便宜模型
  inject_max_cards: 30,    // SessionStart 注入多少张
  capture_min_chars: 250,  // transcript 短于这个（差不多就是啥也没发生）就不采集
  prune_after_days: 90,    // hit_count=0 且超过这么久 → 降权归档
};

function ensureDirs() {
  for (const d of [ME_DIR, MEMORY_DIR, CANDIDATES_DIR, ARCHIVE_DIR]) {
    fs.mkdirSync(d, { recursive: true });
  }
  if (!fs.existsSync(BLOCKLIST_FILE)) {
    fs.writeFileSync(BLOCKLIST_FILE,
      '# 每行一个：不想被 MeBrain 吃进去的目录关键词或词。匹配到就跳过那次采集。\n' +
      '# 例：\n' +
      '# secret\n' +
      '# .env\n' +
      '# 私人\n');
  }
  if (!fs.existsSync(CONFIG_FILE)) {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(DEFAULT_CONFIG, null, 2) + '\n');
  }
}

function getConfig() {
  try { return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) }; }
  catch { return { ...DEFAULT_CONFIG }; }
}

function getBlocklist() {
  try {
    return fs.readFileSync(BLOCKLIST_FILE, 'utf8').split('\n')
      .map(l => l.trim()).filter(l => l && !l.startsWith('#')).map(l => l.toLowerCase());
  } catch { return []; }
}

function today() { return new Date().toISOString().slice(0, 10); }

function slugify(s) {
  return String(s || '').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'card';
}

function shortId() { return Math.random().toString(36).slice(2, 8); }

// ---- frontmatter ----
function parseCard(text, filePath) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return null;
  const meta = {};
  for (const line of m[1].split('\n')) {
    const mm = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
    if (mm) meta[mm[1]] = mm[2].trim();
  }
  return { ...meta, body: m[2].trim(), _file: filePath };
}

function serializeCard(c) {
  const keys = ['name', 'description', 'type', 'created', 'last_seen', 'hit_count',
    'confidence', 'source', 'origin_session', 'scope', 'status', 'done_at'];
  let fm = '---\n';
  for (const k of keys) if (c[k] !== undefined && c[k] !== '') fm += `${k}: ${c[k]}\n`;
  fm += '---\n\n';
  return fm + (c.body || '').trim() + '\n';
}

function readCardsFrom(dir) {
  let out = [];
  let files;
  try { files = fs.readdirSync(dir); } catch { return out; }
  for (const f of files) {
    if (!f.endsWith('.md')) continue;
    try {
      const c = parseCard(fs.readFileSync(path.join(dir, f), 'utf8'), path.join(dir, f));
      if (c) out.push(c);
    } catch {}
  }
  return out;
}

function readAllCards() { return readCardsFrom(MEMORY_DIR); }

function writeCard(c, dir = MEMORY_DIR) {
  ensureDirs();
  c.created = c.created || today();
  c.last_seen = c.last_seen || c.created;
  c.hit_count = c.hit_count !== undefined ? c.hit_count : 0;
  c.confidence = c.confidence !== undefined ? c.confidence : 6;
  c.source = c.source || 'inferred';
  c.scope = c.scope || 'global';
  if (!VALID_TYPES.includes(c.type)) c.type = 'note';
  if (c.type === 'todo' && !c.status) c.status = 'pending';
  const fileName = `${c.type}-${slugify(c.name)}-${shortId()}.md`;
  const fp = path.join(dir, fileName);
  fs.writeFileSync(fp, serializeCard(c));
  c._file = fp;
  return fp;
}

function updateCardFile(c) { if (c._file) fs.writeFileSync(c._file, serializeCard(c)); }

function moveToArchive(c) {
  if (!c._file) return;
  ensureDirs();
  const base = path.basename(c._file);
  fs.renameSync(c._file, path.join(ARCHIVE_DIR, today() + '-' + base));
}

// 项目 key：git root 的目录名，没 git 就用 cwd 的目录名
function projectKey(cwd) {
  try {
    const root = execSync('git rev-parse --show-toplevel', { cwd, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim();
    if (root) return path.basename(root);
  } catch {}
  return path.basename(cwd || process.cwd());
}

function log(msg) {
  try { fs.appendFileSync(CAPTURE_LOG, `[${new Date().toISOString()}] ${msg}\n`); } catch {}
}

// ---- 调用 claude（headless）。带防递归 env guard。失败抛错。----
function callClaude(prompt, model) {
  model = model || getConfig().model;
  const r = spawnSync('claude', ['-p', '--model', model], {
    input: prompt,
    encoding: 'utf8',
    timeout: 180000,
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, MEBRAIN_NESTED: '1' },
  });
  if (r.error) throw new Error('claude spawn failed: ' + r.error.message);
  if (r.status !== 0) throw new Error('claude exited ' + r.status + ': ' + (r.stderr || '').slice(0, 500));
  return (r.stdout || '').trim();
}

// 从 LLM 输出里抠出 JSON（数组或对象），容忍 ```json fences 和前后废话
function extractJson(text) {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  const firstArr = t.indexOf('['), lastArr = t.lastIndexOf(']');
  const firstObj = t.indexOf('{'), lastObj = t.lastIndexOf('}');
  let slice = null;
  if (firstArr !== -1 && lastArr > firstArr && (firstObj === -1 || firstArr < firstObj)) {
    slice = t.slice(firstArr, lastArr + 1);
  } else if (firstObj !== -1 && lastObj > firstObj) {
    slice = t.slice(firstObj, lastObj + 1);
  }
  if (slice === null) throw new Error('no JSON found in output');
  return JSON.parse(slice);
}

// 读 Claude Code 的 transcript .jsonl，抽出 user/assistant 的纯文本，保留最近 maxChars
function readTranscriptText(transcriptPath, maxChars = 30000) {
  let raw;
  try { raw = fs.readFileSync(transcriptPath, 'utf8'); } catch { return ''; }
  const parts = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }
    if (obj.type !== 'user' && obj.type !== 'assistant') continue;
    const msg = obj.message || {};
    const role = msg.role || obj.type;
    let text = '';
    if (typeof msg.content === 'string') text = msg.content;
    else if (Array.isArray(msg.content)) {
      text = msg.content.filter(b => b && b.type === 'text' && b.text).map(b => b.text).join('\n');
    }
    text = (text || '').trim();
    if (text) parts.push(`【${role}】 ${text}`);
  }
  let joined = parts.join('\n\n');
  if (joined.length > maxChars) joined = '…（前略）…\n\n' + joined.slice(joined.length - maxChars);
  return joined;
}

module.exports = {
  HOME, ME_DIR, MEMORY_DIR, CANDIDATES_DIR, ARCHIVE_DIR, BLOCKLIST_FILE, CONFIG_FILE, CAPTURE_LOG,
  VALID_TYPES, DEFAULT_CONFIG,
  ensureDirs, getConfig, getBlocklist, today, slugify, shortId,
  parseCard, serializeCard, readCardsFrom, readAllCards, writeCard, updateCardFile, moveToArchive,
  projectKey, log, callClaude, extractJson, readTranscriptText,
};
