# MeBrain

> Personal long-term memory for [Claude Code](https://docs.claude.com/en/docs/claude-code). Passively distills facts about *you* from sessions, auto-injects them next time, so Claude gets smarter about you over time.

[中文 README →](./README.zh-CN.md)

Plain Markdown cards. No database, no daemon, no npm dependencies. ~900 lines of Node.

---

## What it does

Three hooks wired into Claude Code:

| Hook | Script | What |
|---|---|---|
| `SessionStart` | `inject.js` | Picks the most relevant cards from `~/.me/memory/` and feeds them in as context. File-only, no LLM call. |
| `SessionEnd` | `capture.js` | Reads the transcript, asks Claude (haiku, cheap) to extract a few cards about *you*, writes them as Markdown files. Runs in background, never blocks session exit. |
| `UserPromptSubmit` | `quick-todo.js` | Scans your message for line-start triggers (`提醒我 X` / `记一下 X` / `待办：X` / `TODO: X`) and creates a pending todo card before Claude sees the prompt. |

Plus a `/me` slash command and a `me` CLI for manual CRUD.

Everything lives under `~/.me/`. Every card is one Markdown file you can read, edit, or delete by hand.

---

## Install

**One-liner** (clones to `~/.me_brain`, idempotent — safe to re-run for upgrades):

```bash
curl -fsSL https://raw.githubusercontent.com/Hisensen/me_brain/master/install.sh | bash
```

Then fully quit Claude Code and reopen.

**Manual** (if you don't trust `curl | bash`):

```bash
git clone https://github.com/Hisensen/me_brain.git ~/.me_brain
cd ~/.me_brain
node install.js
```

Either way, `install.js` is idempotent. It patches `~/.claude/settings.json` (backed up first) and deploys the `/me` skill to `~/.claude/skills/me/`. Requires Node.js and `git`; the `claude` CLI is needed for auto-capture and distill but not for injection or real-time todos.

**Upgrade** later: just re-run the one-liner, or `cd ~/.me_brain && git pull && node install.js`.

---

## Use

Most of the time you do nothing — cards get captured at session end and injected at session start.

When you want to inspect or steer:

```
/me show                       list all cards
/me save "I prefer pnpm"       save one quickly
/me save --type pitfall --name "..." --desc "..." --scope global -- <body>
                               structured save (what Claude uses internally)
/me forget <keyword>           archive (not delete — moved to ~/.me/archive/)
/me why <keyword>              show source, body, and the original session jsonl
/me distill                    LLM pass: de-dup, merge, fix bad descriptions, age out
/me log                        tail the capture log
/me todo "ship the README"     new todo
/me todo list                  active todos
/me done <keyword>             mark done & archive
```

**Realtime todos**: just start a line with `提醒我 X` / `记一下 X` / `待办：X` / `TODO: X` in any Claude Code message. The hook creates the card before Claude even sees the prompt. When you later say "X is done", Claude will ask once: "is the `<X>` todo done?" — answer yes and it auto-archives.

---

## How it stores things

```
~/.me/
  memory/        active cards — 1 file = 1 card, plain Markdown
  archive/       forgotten / aged-out cards (timestamped filenames)
  blocklist      directories/words you don't want captured
  config.json    tuning knobs
  CONTEXT.md     mirror of the last injection — see what Claude was told
  .capture.log   automatic capture log
```

A card looks like:

```markdown
---
name: Uses FlClash for proxy
type: fact
created: 2026-05-10
last_seen: 2026-05-13
hit_count: 5
confidence: 9
source: inferred
origin_session: 7e3a...
scope: global
---

User is behind GFW, uses FlClash via 127.0.0.1:7890 for HTTP/HTTPS/SOCKS.
Occasional TLS errors mean a proxy node is bad — switch nodes.
```

**Card types**: `fact`, `preference`, `pitfall`, `decision`, `project`, `reference`, `note`, `todo`.

**Scope**: `global` (about you, cross-project) or `project:<git-root-name>` (current project only). The injector filters by current `cwd` so project cards only show up in their own project.

---

## Architecture

```
Claude Code session
  ├─ UserPromptSubmit  → quick-todo.js   (regex match, synchronous)
  ├─ SessionEnd        → capture.js      (one LLM call, background)
  └─ SessionStart      → inject.js       (file read only, no LLM)
                            ↑
                      /me CLI (me.js)
                      manual CRUD
```

- `bin/inject.js` — sorts cards by scope-match → `confidence` → `last_seen`, takes the top N (default 30), renders them grouped by type. Mirrors the output to `~/.me/CONTEXT.md` so you can always inspect what Claude was told.
- `bin/capture.js` — one `claude -p --model haiku` call per session end, JSON array of cards out. Includes a digest of existing cards in the prompt so the model doesn't duplicate.
- `bin/quick-todo.js` — line-start regex match. Lines starting with third-person pronouns are treated as narration, not commands, and skipped. Writes a `pending` todo and emits hook-feedback telling Claude to acknowledge.
- `bin/me.js` — the `/me` CLI (~440 lines).
- `bin/lib.js` — shared: file IO, frontmatter parse/serialize, Claude subprocess, transcript reader.

Total: ~900 lines of plain Node, zero npm dependencies.

---

## Config (`~/.me/config.json`)

```json
{
  "model": "haiku",
  "inject_max_cards": 30,
  "capture_min_chars": 250,
  "prune_after_days": 90
}
```

- `model` — which Claude model to use for capture and distill. `haiku` is fast and cheap; switch to `sonnet` for better extraction quality.
- `inject_max_cards` — max cards injected at session start.
- `capture_min_chars` — transcripts shorter than this skip capture entirely.
- `prune_after_days` — during `distill`, cards with `hit_count: 0` older than this get archived.

**Blocklist** (`~/.me/blocklist`): one keyword per line. If your `cwd` contains any of them, capture and todo extraction are skipped. Use it to protect private directories.

---

## What's not built yet

Listed in priority order, all deferred until there's a real need:

- `me ingest <path>` — bulk-eat local files/dirs to seed memory.
- **PreToolUse interception** — "you tripped this last time, want to reconsider?"
- **Source connectors** — browser history, Obsidian vault, etc.
- **Real retrieval** — currently scope-filter + confidence-sort. Degrades past ~30 cards. Needs keyword/embedding match.
- **Calibrator** — confidence is set once at capture and never updated. No hit/miss feedback loop.
- `me todo review` — queue captured candidates for manual approval before promoting.

See [`DESIGN-personal-brain.md`](./DESIGN-personal-brain.md) for the original design notes (in Chinese) and the rationale for picking the minimal file-only approach over a full memory engine.

---

## Uninstall

```bash
node uninstall.js          # remove hooks from settings.json, keep your ~/.me data
rm -rf ~/.claude/skills/me # optional: remove the /me skill
rm -rf ~/.me               # optional: nuke all captured memory
```

---

## License

MIT — see [LICENSE](./LICENSE).
