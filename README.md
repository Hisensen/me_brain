# MeBrain

你的个人长期记忆库。被动从 Claude Code 会话里沉淀"关于你本人"的知识（偏好、踩过的坑、决策、项目背景、事实），自动注入回每次新会话，让 cc 越来越懂你。

设计文档见 `../teambrain/DESIGN-personal-brain.md`。这是 v0.1（Approach C：记忆文件优先，纯文件无引擎）。

## 装

```bash
node install.js      # 把两个 hook 写进 ~/.claude/settings.json（自动备份）
# 然后完全退出再重开 Claude Code
```

`/me` 这个 skill 已经放在 `~/.claude/skills/me/`，重启后可用。

## 用

平时啥都不用管 —— 会话结束它自己提炼记录，新开会话它自己注入。偶尔：

```
/me show                      看它记了啥
/me save "我习惯用 pnpm"       主动记一条
/me forget <名字关键词>        删错的（归档，不真删）
/me why <名字关键词>           看某条的来源
/me distill                   立即净化（去重/合并/淘汰过时）
/me log                       看自动采集日志
```

或直接命令行 `node bin/me.js <子命令>`。

## 数据在哪

```
~/.me/
  memory/        现存卡片，每张一个 .md（就是 Markdown，随便看/改/删）
  candidates/    （v0.1 暂未用，预留）
  archive/       被 forget / 净化淘汰的
  blocklist      不想被吃的目录关键词或词，每行一个
  config.json    调参：model / inject_max_cards / capture_min_chars / prune_after_days
  .capture.log   自动采集日志
```

## 卸

```bash
node uninstall.js    # 摘掉 hook，数据 ~/.me/ 保留
rm -rf ~/.claude/skills/me   # 删 skill（可选）
```

## 还没做的（见设计文档）

- `me ingest <path>` —— 把本机文件/文件夹吃进去（跨源第一步）
- PreToolUse 主动提醒（要重蹈覆辙时拦一句"你之前踩过这个坑"）
- 浏览器历史 / Obsidian / 等更多源连接器
- 更聪明的检索（卡片多了之后上关键词/embedding 匹配，抄 TeamBrain 的 matcher）
- 真正的 calibrator（抄 TeamBrain）
