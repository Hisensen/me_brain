# MeBrain — 个人知识沉淀系统（设计稿 v0.1）

> 工作名 MeBrain，随便改。TeamBrain 只是参考骨架。
> 本文档由 /office-hours（builder mode）这次对话产出。状态：DRAFT，待你确认。

---

## 一句话

被动从你的数字活动里默默吞知识、自己净化、让 Claude Code 深度懂你。
v0.1 先做最小可跑的版本（**Approach C：记忆文件优先** —— 纯文件，没引擎，这周能跑）。

## 你在这次对话里说的（原话回放）

- "我当然希望的是一个我不需要主动的让他记录的一个东西，然后就默默的给我记住了"
- "记录的东西……我希望能收集到我的所有的资料，所有的东西的感觉" / "所有的东西我都是需要的"
- "这个是自动净化的一个过程"
- "我使用的时候，可以用一种非常简单的东西询问我是否需要保存的一些觉得很重要的事情，然后自动提醒我这一类的"

→ 拼起来：一个"个人第二大脑"层，被动吞（cc/终端、本机文件、浏览器、笔记……），自己净化（去重/合并/淘汰过时），让 cc 知道你是谁、你的处境、你在干啥；交互很轻：偶尔冒一句"这个挺重要，要存吗？" + 在合适时机主动提醒。

## 目标 / 非目标

**目标（v0.1）**
- 不需要你主动喂
- cc 新开会话就已经懂你（处境 / 偏好 / 坑 / 项目背景）
- 偶尔轻量"要存吗？"
- 自动净化（去重 / 合并 / 淘汰过时）

**非目标（v0.1 暂不做，但架构上留口子）**
- 浏览器 / Obsidian / 微信收藏 等跨源连接器 → v0.2+
- 自动提醒（PreToolUse 拦截）→ v0.2
- sqlite / 向量检索 / monorepo → 等知识库大到顶不住再说，那时抄 TeamBrain
- 团队同步 → 不做

## 前提（已和你确认）

1. **"被动收集一切来源"是片海，不是个湖** —— cc/终端有现成 hook、本机文件 cc 本来就能读，这两个能立刻动手；浏览器/笔记/微信每个都是单独连接器 + 隐私敏感 + 噪音，全做要几个月。先做能下嘴的两个。
2. **"让 cc 懂你"的落地点就是 `CLAUDE.md` + memory + 注入的 additionalContext** —— 不用发明新机制，cc 每次开会话本来就读这些。
3. **"自动净化"是最难也最值钱的一块** —— TeamBrain 的 calibrator（Wilson score / 时间衰减 / 悲观者胜）就是干这个的，真做大了直接抄。

---

## 数据模型 —— 知识卡片（一个卡片一个文件）

沿用你 `~/.claude/projects/.../memory/` 已有的 frontmatter 风格。类型：

| type | 含义 |
|---|---|
| `pitfall` | 踩过的坑（场景 + 错在哪 + 正确做法 + 为什么） |
| `preference` | 偏好 / 工作习惯（你明确表达过的） |
| `decision` | 做过的决策（决定了什么 + 为什么 + 还成不成立） |
| `project` | 项目背景（不可从代码 / git 推出来的） |
| `fact` | 关于你的事实（角色 / 技能 / 处境 / 在用什么） |
| `reference` | 外部资源指针（URL / 看板 / 文档） |

每张卡的 frontmatter：

```markdown
---
name: <3-5 词标题>
description: <一句话；检索时判"这条跟当前场景相关吗"用，要写得让 LLM 一眼能判>
type: pitfall | preference | decision | project | fact | reference
created: 2026-05-12          # 绝对日期，不写"上周"
last_seen: 2026-05-12        # 上次被注入/命中的时间
hit_count: 0                 # 被注入/命中过几次
confidence: 7                # 1-10
source: observed | user-stated | inferred
origin_session: <session-id> # 来自哪次 cc 会话（/me why 用）
scope: global | project:<git-root-name>
---

<正文。pitfall / decision 类再加：>
**Why:** ...
**How to apply:** ...
```

**存储位置（两层作用域，比 TeamBrain 简化）**
- 全局（跨项目，关于"你这个人"）：`~/.me/memory/`
- 项目级（关于某个具体项目）：`~/.me/memory/projects/<git-root-name>/` —— 或者就用 `~/.claude/projects/.../memory/`，二选一（见"还没定的"）
- 候选池：`~/.me/candidates/`（采集出来还没入库的）
- 归档：`~/.me/archive/`（被净化淘汰的，不删，留痕）
- 黑名单：`~/.me/blocklist`（不想被吃的目录 / 关键词）

---

## 三个动作（v0.1 就这三个）

### 1. 采集 —— SessionEnd hook

每次 cc 会话结束：
1. 读这次会话的 transcript（`~/.claude/projects/<proj>/<session>.jsonl`）
2. 一次 LLM 调用（便宜模型，`claude -p --model haiku` 或 claudefast）：
   > "这次会话里有没有值得长期记住的、关于用户的东西？（一个坑 / 一个偏好 / 一个决策 / 一个项目背景 / 一个关于用户的事实）。输出 0-N 张卡片草稿（JSON 数组），每张带 type / name / description / confidence / 正文。**宁缺毋滥** —— 没有就输出 `[]`。不要记代码结构、不要记 git 历史、不要记只对这次对话有意义的东西。"
3. 草稿不直接入库 → 写进 `~/.me/candidates/`
4. 机械校验：type 合法 ✓、description 非空 ✓、跟现有卡不字面重复 ✓ → 通过的落 `~/.me/memory/`
5. confidence 低于阈值的留在候选池，等下次会话再被"印证"（同一张近似卡再出现一次）才升级入库
6. （可选）cc 里冒一句："这次我记下了 N 条关于你的事：[列表]。不对就 `/me forget <name>`。"

### 2. 注入 —— SessionStart hook

每次 cc 开会话：
1. 拿当前 cwd / git-root / 最近 prompt 当上下文
2. 从「全局 memory + 当前项目 memory」里挑最相关的 top-K
   - v0.1 用最笨的办法：把所有卡的 `name + description` 喂给一次 LLM 调用，让它挑 K 条（K=10~20，卡片少的时候这样够用且便宜）
   - 卡片多到这招太贵了，再上 description 关键词匹配 / embedding（抄 TeamBrain matcher）
3. 拼成一段 `additionalContext` 注入（hook 的标准输出方式）
4. 这就是"新开 cc 它就懂了"

### 3. 净化 —— 每周 cron / 手动 `/me distill`

1. 读全部卡片
2. 一次 LLM 调用：
   - 去重 / 合并近似卡
   - 标记过时的（`decision` 还成不成立？`project` 背景变了没？）
   - 给 description 写得烂的卡补好 description
3. `hit_count` 长期为 0 且 `created` 很久的 → 降 confidence → 低于地板 → 移到 `~/.me/archive/`
4. 这就是"自动净化"。地板值、衰减速度跑起来调

---

## 手动入口（轻量交互，做成 cc skill / slash command）

| 命令 | 作用 |
|---|---|
| `/me save <一句话>` | 你主动存一条（给 cc 那句"要存吗？"用，或你自己随手丢） |
| `/me forget <name>` | 删一条（移到 archive） |
| `/me show [type]` | 看现有卡片 |
| `/me why <name>` | 看某条卡来自哪次会话 |
| `/me distill` | 立即跑一次净化 |
| `/me ingest <path>` | 把一个文件夹 / 文件吃进去（v0.2 跨源的预留口子，v0.1 先支持本机文件） |

---

## 跨源扩展（v0.2+，v0.1 只留口子）

`/me ingest <path>` 的实现 = 读文件 → 一次 LLM 调用提卡片 → 进候选池 → 同一套校验 / 净化。
所以以后加浏览器历史、Obsidian、微信收藏，都只是写一个"把那个源 dump 成文本"的小脚本，喂给 `ingest`。
**架构铁律：一开始就别把"采集"写死成只认 cc。** 采集层的输入永远是「一段文本 + 来源标签」，cc 的 SessionEnd 只是其中一个生产者。

## 自动提醒（v0.2）

PreToolUse / UserPromptSubmit hook：拿当前意图去 `description` 匹配 memory，命中 `pitfall` 类就在 cc 反馈里拼一句"你之前这么干踩过坑：……"。直接抄 TeamBrain 的 matcher 思路。v0.1 不做 —— 先把「采集 + 注入 + 净化」这条线跑通。

## 隐私 / 边界

- 全在本机，不上传，不联网
- `~/.me/blocklist` 列不想被吃的目录 / 关键词（含密钥的文件、私人聊天等）
- 采集 hook 自动跳过明显敏感的（`.env` / `credentials` / 私钥 / `.git/`）
- `~/.me/memory/` 里所有卡片就是 Markdown，你随时能看、随时手删
- 采集那次 LLM 调用用本地 `claude -p` —— 数据是发给 Anthropic 的（跟你平时用 cc 一样），介意的话这点要想清楚；要真正本地可换 Ollama 之类，但 v0.1 先不折腾

## 技术栈

- 语言：Node（跟 cc hook 生态一致，TeamBrain 也是 Node）—— 或者干脆 **bash + 一个 `claude -p` 调用**，更轻，v0.1 倾向后者
- 存储：纯文件（Markdown + YAML frontmatter），一个卡片一个文件，git 友好
- LLM：`claude -p` 非交互模式，便宜模型；采集 / 注入 / 净化都是单次调用
- hook：SessionStart + SessionEnd（v0.1）；PreToolUse（v0.2）
- 规模：~200–400 行

## 里程碑

- **M0**：数据模型定下来 + `~/.me/` 目录结构 + `/me save` `/me show` `/me forget`（纯手动，先验证"卡片"这个抽象对不对）
- **M1**：SessionEnd 采集 hook（自动提卡 → 候选池）+ 机械校验入库
- **M2**：SessionStart 注入 hook（"新开 cc 就懂了"跑通）
- **M3**：净化 cron / `/me distill`
- **M4**：`/me ingest <path>`（本机文件跨源）
- **M5+**：自动提醒（PreToolUse matcher，抄 TeamBrain）、更多源连接器（浏览器 / 笔记 / …）

## 还没定的（实现前要拍板）

1. **注入方式**：塞 `additionalContext`（干净、不留痕）还是改项目 `CLAUDE.md` 的托管区块（你能直接看到，但污染 git）？→ 倾向前者
2. **全局卡片位置**：`~/.me/memory/` 还是 `~/.claude/memory/`？→ 倾向独立的 `~/.me/`，跟 cc 解耦，以后别的 agent（Codex 等）也能读
3. **采集模型 / 阈值**：用多便宜的模型？confidence 入库阈值多少？"印证一次才升级"还是直接入库？→ 跑起来调
4. **"项目"怎么识别**：按 cwd 的 git root？没 git 就按目录路径 → 是
5. **采集频率**：每次 SessionEnd 都跑（每次一个 LLM 调用，可能略烦/略贵）还是攒几次再批量？→ 倾向每次跑，但加个"这次会话太短就跳过"的判断

## 下一步（你的作业 —— 不是"去写代码"）

先**手动攒 5–10 张卡片**：就按上面那个 frontmatter 格式，自己写，丢进 `~/.me/memory/`（先 `mkdir -p ~/.me/memory`）。攒的过程你会立刻发现：
- 哪些 `type` 是多余的、缺哪个 `type`
- `description` 该写成啥样，LLM 才"检索时判得出相关性"
- 全局 vs 项目级这条线对不对
- 一张卡多大才合适（一句话？一段？）

攒完这 5–10 张，数据模型就定死了，剩下的（hook / cron / skill）都是机械活，我可以一口气帮你撸。

---

## 附：和 TeamBrain 的对应关系（方便以后抄）

| TeamBrain | MeBrain v0.1 | 以后要不要抄 |
|---|---|---|
| 规则（rule） | 知识卡片（card） | —— |
| 团队 / 项目 / 个人 三层作用域 | global / project 两层 | 够了 |
| SessionStart hook → 编译 CLAUDE.md | SessionStart hook → 注入 additionalContext | —— |
| SessionEnd → correction-detector / success-detector / extractor | SessionEnd → 一次 LLM 调用提卡 | 大了再拆 |
| calibrator（Wilson score / 衰减 / 悲观者胜） | 净化 cron（LLM 去重 + hit_count 衰减） | **v0.3 抄** |
| matcher（BM25 + dense RRF + soft-AND） | LLM 挑 top-K / description 关键词 | **卡片多了抄** |
| PreToolUse 拦截 | （v0.2）PreToolUse 提醒 | **v0.2 抄思路** |
| AttributionBus / Renderer | cc 里那句"我记下了 N 条" | 够了 |
| sqlite + sqlite-vec | 纯文件 | 卡片上千了再说 |
