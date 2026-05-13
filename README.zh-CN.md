# MeBrain

> 给 [Claude Code](https://docs.claude.com/en/docs/claude-code) 用的「个人长期记忆库」。被动从会话里沉淀关于**你这个人**的知识，下次开会话自动注入回去，让 cc 越用越懂你。

[English README →](./README.md)

纯 Markdown 文件、零 npm 依赖、零数据库、零长驻进程。大约 900 行 Node。

---

## 它干啥

三个 hook 挂进 Claude Code：

| Hook | 脚本 | 干啥 |
|---|---|---|
| `SessionStart` | `inject.js` | 从 `~/.me/memory/` 挑最相关的卡片塞进会话上下文。纯读文件，不调 LLM。 |
| `SessionEnd` | `capture.js` | 读 transcript，让 Claude（haiku，便宜）提炼几条「关于你」的卡片，存成 Markdown。后台跑，不阻塞退出。 |
| `UserPromptSubmit` | `quick-todo.js` | 扫你刚发的消息，行首命中触发词（`提醒我 X` / `记一下 X` / `待办：X` / `TODO: X`）就立一张 pending todo 卡。 |

外加一个 `/me` 斜杠命令 + 一个 `me` CLI，方便手动增删改查。

所有东西都在 `~/.me/` 下面，每张卡 = 一个 Markdown 文件，随便你看、改、删。

---

## 装

```bash
git clone https://github.com/Hisensen/me_brain.git
cd me_brain
node install.js
# 然后完全退出 Claude Code 再重开。
```

`install.js` 是幂等的。它会改 `~/.claude/settings.json`（先自动备份），把 `/me` skill 部署到 `~/.claude/skills/me/`。

---

## 用

平时啥都不用管 —— 会话结束它自己沉淀，新会话它自己注入。偶尔手动：

```
/me show                       看所有卡片
/me save "我习惯用 pnpm"        快速记一条
/me save --type pitfall --name "..." --desc "..." --scope global -- <正文>
                               结构化记一条（cc 主动记忆用这个形式）
/me forget <名字关键词>         归档一条（不是真删，挪到 ~/.me/archive/）
/me why <名字关键词>            看某条的来源、正文、原始会话 jsonl
/me distill                    立即净化：去重 / 合并 / 重写差 description / 老化淘汰
/me log                        看自动采集日志
/me todo "把 README 推上去"     立一条 TODO
/me todo list                  看所有活跃 TODO
/me done <关键词>               标完成并归档
```

**实时立 TODO**：在 cc 消息里**行首**说 `提醒我 X` / `记一下 X` / `待办：X` / `TODO: X` —— hook 在 Claude 看到提示词之前就把卡片立好了。

---

## 数据怎么存

```
~/.me/
  memory/        现存卡片，每张一个 .md
  archive/       被 forget 或老化淘汰的（文件名前缀加日期）
  blocklist      不想被吃的目录关键词，每行一个
  config.json    调参
  CONTEXT.md     上次注入的镜像 —— 随时打开看 cc 被告知了啥
  .capture.log   自动采集日志
```

一张卡长这样：

```markdown
---
name: 在 GFW 后，使用 FlClash 代理
type: fact
created: 2026-05-10
last_seen: 2026-05-13
hit_count: 5
confidence: 9
source: inferred
origin_session: 7e3a...
scope: global
---

用户网络在 GFW 后，用 FlClash（Clash GUI）通过 127.0.0.1:7890 代理 HTTP/HTTPS/SOCKS；
偶发 TLS 证书验证错是代理节点临时坏了，换节点即可。
```

**卡片类型**：`fact`（事实）/ `preference`（偏好）/ `pitfall`（坑）/ `decision`（决策）/ `project`（项目背景）/ `reference`（外部资源）/ `note`（粗卡片）/ `todo`（待办）。

**作用域**：`global`（关于你本人、跨项目通用）或 `project:<git 根目录名>`（只跟当前项目有关）。注入时按 `cwd` 过滤，所以项目卡只在对的项目里出现。

---

## 架构

```
Claude Code 会话
  ├─ UserPromptSubmit  → quick-todo.js   （正则匹配，同步）
  ├─ SessionEnd        → capture.js      （一次 LLM 调用，后台）
  └─ SessionStart      → inject.js       （纯文件读，不调 LLM）
                            ↑
                      /me CLI (me.js)
                      手动 CRUD
```

- `bin/inject.js` —— 按 scope 匹配 → `confidence` → `last_seen` 排序，取前 N 张（默认 30），按类型分组渲染。同时把注入快照写到 `~/.me/CONTEXT.md`，你随时能打开看 cc 这次被告知了啥。
- `bin/capture.js` —— 每次会话结束跑一次 `claude -p --model haiku`，要求输出 JSON 数组。prompt 里带上现存卡片摘要，让模型别重复。
- `bin/quick-todo.js` —— 行首正则匹配。第三人称开头的（"他/她/你"）当叙述跳过。立 pending todo + 输出一行 hook 反馈让 cc 回复时确认。
- `bin/me.js` —— `/me` CLI（约 440 行）。
- `bin/lib.js` —— 共享：文件 IO、frontmatter 解析、claude 子进程、transcript 读取。

总共 ~900 行 Node，零 npm 依赖。

---

## 调参（`~/.me/config.json`）

```json
{
  "model": "haiku",
  "inject_max_cards": 30,
  "capture_min_chars": 250,
  "prune_after_days": 90
}
```

- `model` —— 采集和净化用哪个 Claude 模型。`haiku` 快且便宜；要更好的抽取质量换 `sonnet`。
- `inject_max_cards` —— 开会话注入卡片上限。
- `capture_min_chars` —— transcript 短于此 → 跳过采集（这次会话啥也没发生）。
- `prune_after_days` —— `distill` 时，`hit_count=0` 且超过这么久没动的卡片 → 归档。

**Blocklist**（`~/.me/blocklist`）：每行一个关键词，cwd 路径包含任意一个 → 跳过采集和实时 TODO 立卡。用来保护私人目录。

---

## 还没做的

按优先级排，全都是「真出问题再做」的部分：

- `me ingest <path>` —— 把本机文件/文件夹批量吃进来打底
- **PreToolUse 主动拦截** —— 「你之前在这儿摔过，要不要重新想想？」
- **更多源连接器** —— 浏览器历史、Obsidian、笔记本……
- **真正的检索** —— 现在只有 scope 过滤 + confidence 排序，卡片超过 30 张就会开始丢内容。需要关键词/embedding 匹配。
- **真正的 calibrator** —— confidence 现在是采集时静态给一次，没有命中/未命中的反馈环。
- `me todo review` —— 采集到的候选先进队列、你手动确认后再入库。

[`DESIGN-personal-brain.md`](./DESIGN-personal-brain.md) 是最初的设计文档，里面有为啥选「最小文件方案」而不是搞完整记忆引擎的权衡。

---

## 卸

```bash
node uninstall.js          # 摘掉 hook，~/.me 数据保留
rm -rf ~/.claude/skills/me # 可选：删 /me skill
rm -rf ~/.me               # 可选：彻底清空所有采集到的记忆
```

---

## License

MIT —— 见 [LICENSE](./LICENSE)。
