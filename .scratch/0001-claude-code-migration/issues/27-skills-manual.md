# Skill 用户手册与根目录文档走机械提交

Status: completed

## What to build

用户发现 (2026-10-28): README "附带技能" 一节缺少 ticket 07 从规则改成的 9 个 Skill (`arw-commands`, `code-maps`, `issue-tracking`, `reviewer-launch`, `rule-and-design-changes`, `spec-readiness`, `test-performance-optimization`, `test-value-cleanup`, `validation`), 也没有说明哪些 Skill 不会自动触发, 需要用户显式点名. 其他用户可能不知道这些 Skill 的存在. 用户决定:

- 单开用户手册 `docs/manuals/skills.md` 和 `docs/manuals/skills.zh-CN.md`. 上游 Skill 与 ARW 自定义 Skill 分成两个大章节 (用户 2026-10-28); 上游 Skill 由 `upstream/sources/*/source.json` 的映射和排除项确定 (`adoptions.md` 只记录采用与拒绝的决定, 不决定名单), 章节写明来源仓库. 每个大章节内按用途分组列出 `distribution/skills/` 中全部 Skill, 并标明是 Agent 在对应任务前自动使用, 还是不会自动触发 (`disable-model-invocation: true`) 需要显式点名. 详略 (用户 2026-10-28): 上游 Skill 从简, 每个一句话说明用途并链接上游介绍文档; ARW 自定义 Skill 必须详细, 每个写明用途, 何时触发或何时该点名, 主要步骤和产出 (记录, 报告, 提交等), 相关的 `arw` 命令和关联 Skill, 让用户不读 `SKILL.md` 也能判断何时用和会发生什么. 不复制 Skill 的完整合同.
- 根 `README.md` 和 `README.zh-CN.md` 的 "附带技能" 一节缩短为简介加手册链接, 并按读者文档规范更新路由.
- 仓库根目录的文档 Markdown (`README.md`, `README.zh-CN.md`, `CONTEXT.md`, `CLAUDE.md`; 用户 2026-10-28 要求 README, CONTEXT 等都按规则与文档规则处理) 和 `docs/**` 一样走非实施机械提交, 不含测试 fixture: 修改 `arw commit-audit verify --non-implementation` 的路径判定, `commit` Skill 及其投影和分发副本, 长期规范的对应条款; 有测试覆盖.
- 上游与自定义的划分 (Source Checkout 在固定上游提交 `6acc160e4e0cd062dbbbd7a1b26ae92855edf07e` 的 `skills/engineering/` 与 `skills/productivity/` 目录核对 `source.json` 映射得出, `ask-matt` 和 `setup-matt-pocock-skills` 被 `exclude`): `distribution/skills/` 现有 34 个目录, 手册覆盖且仅覆盖这 34 个 (`platform-standards`, `release`, `reviewer-capability`, `upstream-sync` 是只在 Source Checkout `.agents/skills/` 使用的 Skill, 不进入分发, 不入手册). 上游 23 个, engineering 下为 `code-review`, `codebase-design`, `diagnosing-bugs`, `domain-modeling`, `grill-with-docs`, `implement`, `improve-codebase-architecture`, `prototype`, `research`, `resolving-merge-conflicts`, `tdd`, `to-spec`, `to-tickets`, `triage`, `wayfinder`, `wizard`, productivity 下为 `grill-me`, `grilling`, `handoff`, `teach`, `to-questionnaire`, `wait-what`, `writing-for-agents`; 其余 11 个为 ARW 自定义: `application-workflow`, `arw-commands`, `code-maps`, `commit`, `issue-tracking`, `reviewer-launch`, `rule-and-design-changes`, `spec-readiness`, `test-performance-optimization`, `test-value-cleanup`, `validation`. 上游 Skill 在手册中链接固定提交下的 `skills/<engineering|productivity>/<name>/SKILL.md`. "不会自动触发" 以 `SKILL.md` 前置元数据 `disable-model-invocation: true` 为准.
- 初稿 `.tmp/readme-skills.patch` (在 README 补两行列表) 只作参考, 改为手册后不再需要.

预估净增: 手册中英文各约 120 行 (上游 Skill 每个一行, 自定义 Skill 每个约 6 到 10 行), README 净减约 10 行, 代码和手册覆盖测试约 30 行, 长期规范和 Skill 条款约 +5 行, 合计约 +265.

## Spec Requirement

Governing requirements:

- `docs/specs/arw-reader-documentation/spec.md#document-responsibilities`
- `docs/specs/arw-reader-documentation/spec.md#bilingual-maintenance`
- `docs/specs/arw-reader-documentation/spec.md#routing`
- `docs/specs/arw-reader-documentation/spec.md#sources-and-review`
- `docs/specs/agent-repository-workflow/spec.md#work-records-and-implementation-authorization`
- `docs/specs/agent-repository-workflow/spec.md#cli-interface`
- `docs/specs/agent-repository-workflow/spec.md#commit-audit`

## Acceptance criteria

- [x] `docs/manuals/skills.md` 与 `skills.zh-CN.md` 覆盖 `distribution/skills/` 中全部 Skill, 上游与自定义分两个大章节, 标明自动使用或需显式点名; 有测试或检查保证新增 Skill 时手册不遗漏.
- [x] README 两个版本的 "附带技能" 链接到手册, 读者文档路由一致.
- [x] 只改上述根目录文档的暂存候选可以通过 `arw commit-audit verify --non-implementation`; 有测试覆盖.
- [x] 全量测试, 投影与分发检查, `arw text check` 通过.

issue 17 同改 `lib/commit-audit/`, 合入后再开工.

## Blocked by

- issue:0001:17

## Validation

- 手册覆盖: `tests/skills-manual.test.mjs` 逐一核对 `distribution/skills/` 的每个目录名在 `skills.md` 和 `skills.zh-CN.md` 中都以反引号出现. 分组 (上游 23, 自定义 11) 和自动或点名标记由人工对照 `SKILL.md` 前置元数据和固定上游提交核对.
- 根目录文档: `tests/commit-audit/cli.test.mjs` 扩展用例接受 `README.md`, `README.zh-CN.md`, `CONTEXT.md`, `CLAUDE.md`, 并拒绝 `tests/fixtures/README.md`.
- 最终内容上的结果: `pnpm test` 712 项通过, 0 失败, 1 跳过; `pnpm typecheck` 无错误; `node scripts/check-workflow-distribution.mjs` 通过; `node scripts/project-claude-skills.mjs --check` 通过; `node arw.mjs text check` 通过 (645 个文本文件). `arw terms check` 只报告既有的两处 `Artifact` 发现, 不在本 issue 改动内.
- 净增: 手册 270 行, 覆盖测试 13 行, README 两版净减 22 行, 代码, 测试扩展, 长期规范与 Skill 条款约 +20 行, 合计约 +280, 预估约 +265, 未超一倍.

## Comments

- Spec Readiness 共 4 轮 (haiku high), 前 3 轮分别指出: 所选要求章节未覆盖实际改动的规则, 上游划分的事实来源缺失, 路径式要求的标题结构不合格; 均通过补充 issue 的要求引用和事实清单解决, 未修改 spec 来回应 Reviewer, 未启动共同决定 subagent.
- 本 issue 自己新增的 spec 条款: 读者文档规范增加 Skills 手册责任行和机械检查范围; 长期规范的轻量提交条款纳入根目录 README, CONTEXT, CLAUDE.
