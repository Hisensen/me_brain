# MeBrain

你的个人长期记忆库 + 实时 TODO 系统。被动从 Claude Code 会话里沉淀"关于你本人"的知识（偏好、踩过的坑、决策、项目背景、事实），自动注入回每次新会话，让 cc 越来越懂你；同时支持你随口说"提醒我 X"实时立 TODO，cc 在做完时主动帮你确认。

设计文档见 `../teambrain/DESIGN-personal-brain.md`。当前 v0.2（在 v0.1「Approach C：记忆文件优先」基础上加 TODO 与实时口令识别）。

## 装

```bash
node install.js      # 装 3 个 hook + 部署 /me skill（自动备份 settings.json）
# 然后完全退出再重开 Claude Code
```

部署内容：
- `SessionStart` hook → `inject.js`（注入记忆 + 活跃 TODO）
- `SessionEnd` hook → `capture-hook.sh`（后台采集知识卡）
- `UserPromptSubmit` hook → `quick-todo.js`（实时口令识别）
- `~/.claude/skills/me/SKILL.md`（`/me` 命令的 skill 定义）

## 用

平时啥都不用管 —— 会话结束它自己提炼知识，新开会话它自己注入；你说"提醒我 X"它实时立 TODO。偶尔：

```
/me show                      看它记了啥
/me save "我习惯用 pnpm"       主动记一条
/me forget <名字关键词>        删错的（归档，不真删）
/me why <名字关键词>           看某条的来源
/me distill                   立即净化（去重/合并/淘汰过时）
/me log                       看自动采集日志

/me todo "改完 README"         手动立 TODO
/me todo list                 看活跃 TODO
/me done <关键词>              标完成并归档
```

或直接命令行 `node bin/me.js <子命令>`。

## 实时 TODO 口令（v0.2 新加）

消息**行首**这几种写法 → UserPromptSubmit hook 实时立 TODO（不走 cc）：

- `提醒我 X` / `提醒我，X` / `提醒我一下 X`
- `记一下 X` / `记下 X`
- `待办：X`
- `TODO: X`

立完之后 cc 会在回复时给你一行确认；下次开会话注入也会带出来。完成时你随口说"X 改完了"，cc 会主动问"那条 X 的 TODO 完成了吗？"，你说"是" → 自动归档。

## 数据在哪

```
~/.me/
  memory/        现存卡片，每张一个 .md（含 todo 卡）
  candidates/    （v0.3 候选审核用，目前预留）
  archive/       被 forget / done / 净化淘汰的
  blocklist      不想被吃的目录关键词或词，每行一个
  config.json    调参：model / inject_max_cards / capture_min_chars / prune_after_days
  .capture.log   自动采集日志（含 quick-todo 实时日志）
```

## 卸

```bash
node uninstall.js    # 摘掉 3 个 hook，数据 ~/.me/ 保留
rm -rf ~/.claude/skills/me   # 删 skill（可选）
```

## 还没做的（见设计文档）

- v0.3：`/me todo review` 候选审核（hook 用 LLM 嗅探弱信号的提醒）
- `me ingest <path>` —— 把本机文件/文件夹吃进去（跨源第一步）
- PreToolUse 主动提醒（要重蹈覆辙时拦一句"你之前踩过这个坑"）
- 浏览器历史 / Obsidian / 等更多源连接器
- 更聪明的检索（卡片多了之后上关键词/embedding 匹配，抄 TeamBrain 的 matcher）
- 真正的 calibrator（抄 TeamBrain）
