# 语言检查改为按需调用的检查程序

Status: ready-for-agent

## What to build

用户决定 (2026-10-27): 文档语言规则仍然存在, 但不再由配置文件硬性要求, 改为 Agent 在需要时调用检查程序.

- 保留一个检查程序: 给定一个文件或一个目录, 报告其中每份文档的中文, 英文与其他字符比例 (沿用现有 `languageComposition` 的统计), 不设门槛, 不判定通过或失败.
- 删除 `arw.config.json` 的 `languageChecks` 配置及所有依赖它的代码, 测试和文档: 配置解析与校验, `arw terms check` 结果中的 `languageChecks`, 相关诊断和展示, `docs/agents/writing.md`, `validation` Skill (含投影和分发副本), 长期规范 (`docs/specs/agent-repository-workflow/spec.md` 的 Document terms 节, application-jira spec 中的引用), 本 effort spec 第 145 行的默认值说明. 本仓库 `arw.config.json` 中的 `languageChecks` 一并删除; ticket 19 为 7 份文档另设的比例门槛随之取消.
- `docs/agents/writing.md` 写明何时调用检查程序 (如新建或大幅改写文档后).
- 配置迁移做成通用功能: `arw workflow update` 已能为目标仓库补充新的默认字段, 再增加一份 "已废弃字段" 列表, update 时从目标仓库 `arw.config.json` 中删除列表内字段并在结果中报告. 本次列表只有 `languageChecks`. 增加与删除都是可复用的程序功能, 不写一次性脚本.
- 发布流程对候选分发文档的语言检查 (`checkDocumentTerms` 的 `languageThresholds` 请求参数, 不来自配置) 是否一并取消, 待用户决定; 未决定前不改.

预估净增: 删除约 300 行, 新增约 60 行 (检查程序入口, 废弃字段迁移及测试), 净增约 -240 行.

## Spec Requirement

Governing requirements:

- `docs/specs/agent-repository-workflow/spec.md#document-terms`
- `docs/specs/agent-repository-workflow/spec.md#init-update-verify-and-remove`

## Acceptance criteria

- [ ] 检查程序对一个文件和一个目录都能输出每份文档的语言比例, 没有门槛和失败状态; 有测试覆盖.
- [ ] 仓库内 (代码, 测试, 规则, Skill 及副本, 长期规范, 本仓库配置) 不再出现 `languageChecks`, 发布流程部分按用户决定处理.
- [ ] `arw workflow update` 删除目标仓库 `arw.config.json` 中的已废弃字段并报告, 同时仍补充新默认字段; 有隔离目标仓库测试覆盖.
- [ ] `docs/agents/writing.md` 写明检查程序的调用时机.
- [ ] 全量测试, 类型检查, 投影与分发检查通过.

## Blocked by

- None - can start immediately
