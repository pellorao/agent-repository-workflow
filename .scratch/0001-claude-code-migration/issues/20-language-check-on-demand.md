# 语言检查改为按需调用的检查程序

Status: completed

## What to build

用户决定 (2026-10-27): 文档语言规则仍然存在, 但不再由配置文件硬性要求, 改为 Agent 在需要时调用检查程序.

- 保留一个检查程序: 给定一个文件或一个目录, 报告其中每份文档的中文, 英文与其他字符比例 (沿用现有 `languageComposition` 的统计), 不设门槛, 不判定通过或失败.
- 删除 `arw.config.json` 的 `languageChecks` 配置及所有依赖它的代码, 测试和文档: 配置解析与校验, `arw terms check` 结果中的 `languageChecks`, 相关诊断和展示, `docs/agents/writing.md`, `validation` Skill (含投影和分发副本), 长期规范 (`docs/specs/agent-repository-workflow/spec.md` 的 Document terms 节, application-jira spec 中的引用), 本 effort spec 第 145 行的默认值说明. 本仓库 `arw.config.json` 中的 `languageChecks` 一并删除; ticket 19 为 7 份文档另设的比例门槛随之取消.
- `docs/agents/writing.md` 写明何时调用检查程序 (如新建或大幅改写文档后).
- 配置迁移做成通用功能: `arw workflow update` 已能为目标仓库补充新的默认字段, 再增加一份 "已废弃字段" 列表, update 时从目标仓库 `arw.config.json` 中删除列表内字段并在结果中报告. 本次列表只有 `languageChecks`. 增加与删除都是可复用的程序功能, 不写一次性脚本.
- 发布流程对候选分发文档的语言检查 (`checkDocumentTerms` 的 `languageThresholds` 请求参数) 一并取消 (用户 2026-10-27 选 A): 删除该参数及发布工具的门槛, `release` Skill 改为发布前调用检查程序看报告, 由 Agent 对照语言规则判断; `AGENTS.md` "Source Checkout Validation" 中 "非发布流程不判断 ... 发布流程仍检查候选分发文档" 一条相应改写或删除.

预估净增: 删除约 300 行, 新增约 60 行 (检查程序入口, 废弃字段迁移及测试), 净增约 -240 行.

## Spec Requirement

Governing requirements:

- `docs/specs/agent-repository-workflow/spec.md#document-terms`
- `docs/specs/agent-repository-workflow/spec.md#init-update-verify-and-remove`
- `docs/specs/agent-repository-workflow/spec.md#document-language-inspection`

## Acceptance criteria

- [x] 检查程序对一个文件和一个目录都能输出每份文档的语言比例, 没有门槛和失败状态; 有测试覆盖.
- [x] 仓库内 (代码, 测试, 规则, Skill 及副本, 长期规范, 本仓库配置) 不再出现 `languageChecks`, 唯一例外是 `arw workflow update` 的已废弃字段列表, 其测试, 以及描述该列表的 spec 句子; `languageThresholds` 与发布门槛已删除, `release` Skill 改为调用检查程序.
- [x] `arw workflow update` 删除目标仓库 `arw.config.json` 中的已废弃字段并报告, 同时仍补充新默认字段; 有隔离目标仓库测试覆盖.
- [x] `docs/agents/writing.md` 写明检查程序的调用时机.
- [x] 全量测试, 类型检查, 投影与分发检查通过.

## Blocked by

- None - can start immediately

## Validation

- `pnpm test`: 706 项, 705 通过, 1 跳过, 0 失败. `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `arw text check` 通过. `arw terms check` 只剩两处既有的 `Artifact` 大写发现, 与本 ticket 无关.
- 验收 1: 检查程序为既有 `arw language inspect`, 文件与目录均由 `tests/arw-common/document-language-inspection.test.mjs` 覆盖, 无门槛和失败状态.
- 验收 2: 除已废弃字段列表, 其测试和 spec 句子外, 仓库不再出现 `languageChecks`; `languageThresholds`, `--language-threshold`, `--verbose` 和 `arw terms check` 的语言输出已删除, `release` Skill 改为调用 `arw language inspect distribution`.
- 验收 3: `tests/repository-workflow/workflow.test.mjs` 与隔离临时仓库中的 `arw workflow update --non-interactive` 均删除 `languageChecks`, 输出 `Removed deprecated fields from arw.config.json: languageChecks.`, 同时补入 `reviewers` 默认值; 再次 update 输出 `No changes.`.
- 验收 4: `docs/agents/writing.md` 及分发副本已写明调用时机.

## Comments

- 偏差: 先实现后跑 Spec Readiness, 违反 `implement` Entry 顺序; Spec Readiness 共 3 轮 (haiku high), 前两轮的 8 项问题与 Input 缺口已按 Main Agent 与独立 subagent 共同决定修正 spec (已废弃字段的输出行, 不算版本迁移, 设计理由, 不需要新 ADR), 第 3 轮 `No problems.`.
- 历史记录 `issues/02-dual-platform-projection.md` 中对旧 `languageChecks` 配置的叙述未改, 属于已完成 ticket 的过程记录, 不在验收 2 列出的类别内.
- 已废弃字段的删除与报告只在 `workflow update` 发生, `workflow init` 只忽略它们 (requirements-reviewer 提出 init 不应删除, 采纳).
- 范围决定: `arw terms check` 不再读取 `arw.config.json` (它只为 `languageChecks` 服务), 一并删除相关代码, 诊断和 spec 描述; 已废弃字段在 `workflow update` 前被所有读取方忽略.
