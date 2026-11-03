# 仓库状态与配置清理

Status: completed

## What to build

本 issue 属于 effort 0022, 处理 `.tmp/triage.md` 的 H17-H22. 已重新核对源码与调用方, 按用户授权实施下列行为保持清理.

- H17: 检查器公开参数及工作流注入类型仍包含 repositoryLocation, 删除会改变 Interface, 因此跳过并保留原实现.
- H18-H19: 删除 uniqueSorted 前多余 Set 和 parseHeadTreeEntries 未使用的 type 字段, 保留 blob/commit 格式检查.
- H20: 普通赋值不能通过 ReviewerOverrides 的严格索引类型检查, 需额外类型收窄, 按本轮跳过类型收窄级联的边界保留原实现.
- H21: 简化 repository-configuration.mjs 的错误信息提取.
- H22: 合并 repository.mjs 的相同返回分支.

行为保持重构例外: 只删除死代码或不可达分支, 或合并完全相同的重复实现; 命令输出, 公开 Interface, 错误结果和持久状态不变; 不改变 Module 责任, Interface, Seam, 依赖方向, 权威来源或数据流; 不改动长期规范. 不运行 Spec Readiness, 提交审核照常运行.

体积预算: 非测试源码净增不超过 0 行. 只做当前清理, 不修改 `lib/background-agent/**`, 不安装, 不 push. 命令输出, 公开 Interface, 错误结果和持久状态保持不变; 需要类型收窄级联, 新诊断码或规范变更的发现跳过并记录.

预期验证: `node --test tests/arw-common/*.test.mjs tests/repository-workflow/*.test.mjs`, `pnpm test`, `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `node arw.mjs text check`, `node arw.mjs terms check --include .scratch/0022-triage-code-backlog/` 和 `git diff --check`. 定向文件路径在实施时核对, 不存在时选择该模块实际测试.

相关边界: 未找到仓库, 缺失或非目录 scratch, Git tree 类型, 配置拒绝和审查角色字段.

## Acceptance criteria

- [x] 已确认的范围完成, 已修复或不适用项明确记录, 可观察行为和公开合同不变.
- [x] 取得预期验证通过证据, 原有边界覆盖继续通过.

## Blocked by

- None - can start immediately

## Validation

- H18-H19: 保留 Git HEAD 的 blob/commit 格式校验, 删除未使用的 type 字段及多余去重. `tests/arw-common/repository-state-inspector.test.mjs` 的 index/HEAD 批量读取和 changedPaths 断言继续通过.
- H21: 已完整核对 validateReviewerConfiguration 及 validateReviewerFields 的抛错路径, 均抛出 Error, 删除不可达的 String 回退, 保留原诊断消息和代码.
- H22: 缺失与目录 scratch 共用返回, 其他类型仍抛出原错误. 仓库发现与 CLI 既有测试继续通过.
- `node --test tests/arw-common/*.test.mjs tests/repository-workflow/*.test.mjs` 通过, 共 23 个文件. `pnpm test` 通过, 共 814 个测试, 0 个失败. 未新增或语义修改测试.
- 最终源码的 `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check` 全部通过. 三个改动源码文件经 `node --check` 通过.
- `node arw.mjs text check`, `node arw.mjs terms check --include .scratch/0022-triage-code-backlog/`, `git diff --check` 通过.
- 非测试源码新增 5 行, 删除 7 行, 净减少 2 行, 满足预算.

## Comments

- 2026-11-01: 按用户授权筛查并实施一个 issue. H17 会改变检查器的公开输入, 按要求跳过. H20 试用普通赋值时严格类型检查报 TS7053, 为避免扩大类型收窄范围已恢复准确 HEAD 内容, 保留原实现. 未修改 Reviewer 规则, 无需能力测试.
- 第 1 轮 Code Standards 和要求符合 Reviewer 均正常完成, 报告均为 No problems. Main Agent 抽查 HEAD tree 正则的分组索引和 candidateFiles 使用路径, 以及非目录 scratch 的既有拒绝行为, 未发现漏检. 本轮之后只补充本章记录.
