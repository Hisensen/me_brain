---
name: me
description: MeBrain — 用户的个人长期记忆库 + TODO 系统。当用户输入 /me（带子命令 save/show/forget/why/distill/log/todo/done）时调用；也用于在对话中发现关于用户本人的、值得长期记住的信息时，主动提议"要我记下来吗？"并写入。数据在 ~/.me/，由 {{ME_BRAIN_DIR}} 实现。
---

# MeBrain（个人长期记忆 + 实时 TODO）

用户有一个个人长期记忆库（"第二大脑"），数据在 `~/.me/memory/`（每张卡片一个 Markdown 文件），CLI 在 `{{ME_BRAIN_DIR}}/bin/me.js`。

## 当用户输入 `/me <子命令> ...`

直接运行对应命令并把输出给用户：

```
node {{ME_BRAIN_DIR}}/bin/me.js <子命令> <参数...>
```

子命令：
- `save "<随手一句>"` — 快速记一条
- `save --type <pitfall|preference|decision|project|fact|reference> --name "<标题>" --desc "<一句话>" --scope <global|project:NAME> -- <正文>` — 结构化记一条
- `show [type]` — 看所有卡片（可按类型过滤）
- `forget <名字关键词>` — 归档一条（挪到 archive/，不是真删）
- `why <名字关键词>` — 看某条卡片的来源/正文/原始会话
- `distill` — 立即净化：去重/合并/标记过时（会调一次 LLM，十几秒）
- `log` — 看自动采集日志
- `todo "<内容>"` — 立一条 TODO
- `todo list` — 看活跃 TODO
- `done <关键词>` — 标完成并归档
- `help` / 无参数 — 帮助

`/me` 不带参数 → 跑 `me.js show` 给用户看现状，再附一句帮助。

## TODO 系统（v0.2 新加）

TODO 是 MeBrain 里**有完成态**的卡片类型（type=todo, status=pending|done），跟"事实/偏好/坑"这种永久知识不同。

**两种入口立 TODO**：
1. **实时口令**（推荐）：用户消息**行首**说「**提醒我 X**」/「**记一下 X**」/「**记下 X**」/「**待办：X**」/「**TODO：X**」 → UserPromptSubmit hook 自动立卡，cc 收到 hook 反馈后用一行简短确认。
2. **CLI**：`/me todo "<内容>"` 或 `me todo "<内容>"`。

**注入**：每次会话开头，inject.js 会把活跃 TODO 列在「📋 活跃 TODO」段里，并附带行为指南。

**主动完成确认**（cc 的职责）：
- 用户在对话中提到某条 TODO 的目标动作疑似已完成（如"X 改完了"、"刚 commit 了 Y"），**主动用一句话问一次**："那条 `<TODO 名>` 的 TODO 是这个完成了吗？" 用户确认后跑 `me done "<关键词>"`。
- 每条 TODO 在同一会话里最多问一次，被否决就别再问。
- 没有明确线索时，不要主动提 TODO。

## 主动记忆（不需要用户输入 /me 也可以做）

当对话中**自然出现**关于用户本人的、值得长期记住的信息时 —— 比如：
- 一个偏好 / 工作习惯（"我习惯用 pnpm"、"我不喜欢在 main 上直接改"）
- 一个踩过的坑（"上次 X 配置错了导致 Y"）
- 一个决策（"我们决定 Z 用 A 方案，因为 B"）
- 一个项目背景（不可能从代码/git 推出来的上下文）
- 一个关于用户的事实（角色、处境、在用什么工具）

—— 就**简短地问一句**："这个要我记进 MeBrain 吗？"。用户确认后运行结构化的 `save`：

```bash
node {{ME_BRAIN_DIR}}/bin/me.js save \
  --type <pitfall|preference|decision|project|fact|reference> \
  --name "<3-6 词标题>" \
  --desc "<一句话，将来检索靠它判断相关性>" \
  --scope <global 或 project:当前git根目录名> \
  -- <正文。pitfall/decision 写清楚 为什么 和 怎么应用>
```

判断 scope：跟用户这个人有关、跨项目通用的 → `global`；只跟当前项目有关的 → `project:<当前 git 根目录的目录名>`（`git rev-parse --show-toplevel` 取最后一段；没 git 就用当前目录名）。

**别太频繁**。一次会话里提议保存的次数控制在 0-3 次。明显临时的、能从代码直接看出来的、CLAUDE.md 已经写了的，都不要提。宁缺毋滥。

## 注意

- 这个库每次开会话会被自动注入到上下文（你现在看到的"关于用户的长期记忆"那段就是它）。
- 用户随时可以 `me show` 看全部、`me forget` 删错的、编辑 `~/.me/memory/*.md` 手改、编辑 `~/.me/blocklist` 设禁区。
- 三个自动 hook：UserPromptSubmit（实时口令 → todo）、SessionEnd（后台采集知识卡）、SessionStart（注入）。结果都看 `me log`。
