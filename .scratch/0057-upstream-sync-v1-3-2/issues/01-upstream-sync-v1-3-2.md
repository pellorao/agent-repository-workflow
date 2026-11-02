# 上游 Skill 同步到 v1.3.2

Status: completed

## What to build

按 `$upstream-sync` 把 mattpocock-skills 从 `6acc160e4e0cd062dbbbd7a1b26ae92855edf07e` 同步到最新发布版 v1.3.2 `d1478fcb140db0b93c0c8df17bcfd311844749d0` (维护者 2026-11-03 逐项审定采用范围), 改动按 ARW 格式写成中文:

- `diagnosing-bugs`: Phase 5 强制变红时先与原始副本 `diff`, 证明改动生效; 删除 Phase 6 "什么本可以防止这个 bug" 一段, 标题改为 Cleanup.
- `tdd`: 每个候选 Seam 附一行能抓到和抓不到什么.
- `teach`: 工作区路径相对启动目录解析, 只有 `*-FORMAT.md` 链接相对 Skill 目录; 测验正确答案位置轮换, 不用格式或顺序泄露答案.
- `grilling`: 采用上游每轮格式 (不用 emoji 标记), 问题措辞让回答 "是" 即接受推荐答案.
- 上游在 `research`, `grilling`, `codebase-design/DESIGN-IT-TWICE.md`, `improve-codebase-architecture` 中各写一次的 "subagent 从全新上下文启动", 只在 `docs/agents/subagent-allocation.md` 写一次: 新建的实例从全新上下文启动, 不 fork 创建者的上下文. `research`, `codebase-design`, `improve-codebase-architecture` 已引用该文档, `grilling` 的委派由根 `AGENTS.md` 的委派触发覆盖, 都不重复写.
- `implement`: Entry 第 1 步开工前先说出授权 issue 的标题.
- `wizard/template.sh`: 逐字节采用上游.
- 新 Skill `retro`: 由上游译为中文并按 ARW 本地化 (编码规范写入 Code Standards Reviewer 逐项应用的适用 Agent 指令, 默认只看当前会话, 候选写出目标路径和拟议改动, 选定后按 `$rule-and-design-changes` 实施), 保留 `disable-model-invocation: true`, `openai.yaml` 设 `allow_implicit_invocation: false`, description 为面向人的一行摘要; 登记到 `distribution/config.json` 的 `distributedSkills`.
- `source.json`: `commit` 改为 v1.3.2, `exclude` 加入 `skills/engineering/implement-spec/` 与 `skills/engineering/pr/`.
- `adoptions.md`: 补入 2026-10-30 六个 Skill 本地化的记录 (按时间插在 3 个 Skill 拒绝记录之前), 末尾追加本次同步的采用与拒绝及原因.
- 用户手册 `docs/manuals/skills.md` 与 `docs/manuals/skills.zh-CN.md`: 加入 `retro` (上游 Skill 数量 20 改为 21, 需显式点名, 强调经常执行: 每完成一个 issue 或一段较长会话后运行一次); `diagnosing-bugs` 条目提示修复后运行 `$retro` 找预防办法; 上游链接改到 v1.3.2.
- 用 `node scripts/project-claude-skills.mjs`, `node scripts/sync-workflow-distribution.mjs`, `node scripts/generate-install-arw.mjs` 重新生成 `.claude/skills/`, `distribution/` 与安装脚本副本.

不吸收: 去长破折号, 措辞润色, "call the Skill tool" 写法, `CONTEXT.md` 改名 `GLOSSARY.md`, 外部跟踪器, sub-issue, 分流标签和 PR 相关改动.

体积预算: 除逐字节采用的上游 `template.sh` 外不新增代码; 文档净增约 6000 字符, 其中 `retro` 约 3000 字符.

## Acceptance criteria

- [x] 上述各 Skill 的改动已写入 `.agents/skills/`, 生成副本由脚本生成.
- [x] `retro` 为中文, 只能显式调用, 已登记分发.
- [x] `source.json` 的 `commit` 为 v1.3.2, `exclude` 含两个新路径; `adoptions.md` 含本地化记录和本次记录.
- [x] 两份手册内容对应, 列出 21 个上游 Skill.
- [x] 验证命令退出码 0.

## Blocked by

None.

## Validation

- `pnpm typecheck`, `pnpm test` (867 pass, 0 fail), `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `node arw.mjs text check`, `git diff --cached --check` 退出码均为 0.
- 改动位置: `.agents/skills/{diagnosing-bugs,tdd,teach,grilling,implement}/SKILL.md`, `.agents/skills/wizard/template.sh`, `.agents/skills/retro/`, `distribution/config.json`, `upstream/sources/mattpocock-skills/{source.json,adoptions.md}`, `docs/manuals/skills.md`, `docs/manuals/skills.zh-CN.md`, `docs/agents/subagent-allocation.md`; 副本由三个生成脚本生成.
- `retro` 只能显式调用: `SKILL.md` 含 `disable-model-invocation: true`, `agents/openai.yaml` 为 `allow_implicit_invocation: false`.
- 体积: `template.sh` 净增 19 行 (上游逐字节采用); 文档按 `git diff --cached` 中 `.agents/skills`, `docs`, `upstream` 下 Markdown 的全部增删行计 (不含生成副本; 改写的手册链接行整行计入新增和删除): 新增 15130 字符, 删除 10302 字符, 净增 4828 字符, 在预算内.
- Spec Readiness: 记录 `not-applicable` 例外 (用户 2026-11-02 常设确认).
- 只删减与合并的自查: 改动均为维护者审定的采用项, 无可再删减内容.

## Comments

- 提交审核第 1 轮: `template.sh` 净增 19 行代码, 来自维护者决定的上游逐字节采用, 无可删减部分; 体积记录改用字符; "全新上下文" 规则按单一来源要求移到 `docs/agents/subagent-allocation.md`, 不在 4 个 Skill 中重复.
- 提交审核第 2 轮: 体积按全部增删行重新计量; "全新上下文" 改放 `docs/agents/subagent-allocation.md` 是 Main Agent 按单一来源要求调整的位置 (Agent 指令修改按用户规则不逐处预先确认, 由维护者按本 issue 复核整体 diff), 已在对话中告知维护者; 该句不加 "只依据交接内容工作" 之类额外约束.
- 提交审核第 3 轮: 维护者 2026-11-03 在对话中明确授权: 把上游在 4 个 Skill 里各写一次的 "从全新上下文启动", 改为引用 `docs/agents/subagent-allocation.md` 中的同一句话. `research`, `codebase-design`, `improve-codebase-architecture` 已引用该文档, `grilling` 的委派由根 `AGENTS.md` 的委派触发引用.
