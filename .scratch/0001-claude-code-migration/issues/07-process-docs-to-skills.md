# 流程文档改为自动触发的 Skill

Status: completed

## What to build

按 spec 列表把流程文档改为由描述自动触发的 Skill (实施, 提交, Spec Readiness, Reviewer 启动, issue 跟踪, 验证, 领域建模, ARW 命令, Code Map, 规则与设计修改, 测试清理, 测试性能优化), 删除文档间重复陈述. `implement` 开头重申最高原则. Reviewer 协议和角色文件仍由运行时读取.

预估改动: 规则净减.

## Spec Requirement

Governing requirements:

- `.scratch/0001-claude-code-migration/spec.md#rule-structure-and-context-budget`

## Acceptance criteria

- [x] 最重日常流程不超过 40K token, 预算测试覆盖并通过.
- [x] 同一要求只在一处定义.
- [x] 两个平台的投影和分发副本同步.

## Blocked by

- 06 常驻核心规则与预算测试

## Comments

- 新增 Skill: `commit`, `spec-readiness`, `reviewer-launch`, `issue-tracking`, `validation`, `arw-commands`, `code-maps`, `rule-and-design-changes`, `test-value-cleanup`, `test-performance-optimization`; `implement` 并入 issue-gate, `domain-modeling` 并入 domain. 删除 16 份 `docs/agents/` 流程文档; `reviewer.md` 只保留 Reviewer 协议 (13726 -> 5484 字符).
- 最重日常流程 (常驻 + implement, spec-readiness, validation, issue-tracking, reviewer-launch, commit, code-review 及其必读文档): 改前约 48.7K token (63275 字符), 改后约 36.4K token (47380 字符). 若把只交给 Reviewer 的 `reviewer.md` 也计入: 改前约 59.2K, 改后约 40.7K. 预算测试 `tests/rule-budget.test.mjs` 按前一口径检查 40K 上限.
- Source Checkout 专有内容移入根入口 Repository-owned 区域和新的 `docs/agents/source-checkout-exceptions.md`.
- `docs/agents/`, `.agents/skills/` 和根入口净减约 400 行; 全部改动 125 个文件, +1268/-2110 行.
- 测试: 1058 项, 1053 通过, 2 失败 (均为改前已存在的 `AGENTS.md` 改名所致), 3 跳过; `pnpm typecheck` 和 `node scripts/check-workflow-distribution.mjs` 通过.
- 独立审查发现: 本仓库免逐处确认的例外未标明为 Baseline 例外, `implement` 描述未覆盖 Wayfinder 和规划记录, 4 处重复陈述, 开发规格仍要求已删除检查的 code-maps 来源; 均已修正.
