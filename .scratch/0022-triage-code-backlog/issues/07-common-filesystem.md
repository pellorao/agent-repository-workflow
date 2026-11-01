# 公共文件系统与文档语言清理

Status: completed

## What to build

本 issue 属于 effort 0022, 已重新核对 `.tmp/triage.md` 的 H33-H37 及调用边界, 按既有授权实施 H35. H33 修改导出函数 analyzeDocumentLanguage 的输入类型, H34 和 H36 新增跨模块导出, 三项移至 issue:0022:20 独立设计和 Spec Readiness, 本轮保留原实现. H37 删除 Repository.identity 会改变公开返回合同, 按本 issue 边界跳过并保留原实现.

- H35: 用文件内 removeTemporary 合并 create-atomic 和 replace 失败后的相同 unlink 尽力清理, 保留 create-atomic 的 temporaryWritten 条件, 原始失败阶段和错误结果.

行为保持重构例外: 只删除死代码或不可达分支, 或合并完全相同的重复实现; 命令输出, 公开 Interface, 错误结果和持久状态不变; 不改变 Module 责任, Interface, Seam, 依赖方向, 权威来源或数据流; 不改动长期规范. 不运行 Spec Readiness, 提交审核照常运行.

体积预算: 非测试源码净增不超过 10 行. 只做当前清理, 不修改 `lib/background-agent/**`, 不安装, 不 push. 命令输出, 公开 Interface, 错误结果和持久状态保持不变; 需要类型收窄级联, 新诊断码或规范变更的发现跳过并记录.

预期验证: `node --test tests/common/*.test.mjs tests/arw-common/document-language-inspection.test.mjs`, `pnpm test`, `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `node arw.mjs text check`, `node arw.mjs terms check --include .scratch/0022-triage-code-backlog/` 和 `git diff --check`. 定向文件路径在实施时核对, 不存在时选择该模块实际测试.

相关边界: 文件事务失败与清理失败, 路径分隔符, 根目录, 文档正文筛选和仓库身份.

## Acceptance criteria

- [x] 已确认的范围完成, 已修复或不适用项明确记录, 可观察行为和公开合同不变.
- [x] 取得预期验证通过证据, 原有边界覆盖继续通过.

## Blocked by

无.

## Validation

- H35: create-atomic 失败仍只在 temporaryWritten 为真时尝试清理; replace 失败仍无条件尝试清理. 两处都等待 unlink, 忽略其失败, 返回原错误及原阶段 file-create-atomic 或 file-replace. 成功路径没有变化.
- 既有 tests/common/filesystem.test.mjs 验证原子创建, 碰撞和替换失败保留原文件且清理临时文件; tests/common/file-transaction.test.mjs 验证失败后的回滚结果. `node --test tests/common/*.test.mjs tests/arw-common/document-language-inspection.test.mjs` 通过, 共 12 个测试文件.
- `pnpm test` 通过, 共 814 个测试, 0 个失败. `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check` 和 `node --check lib/common/filesystem.mjs` 通过. 未新增或语义修改测试.
- `node arw.mjs text check`, `node arw.mjs terms check --include .scratch/0022-triage-code-backlog/`, 两个 issue 文件的 language inspect 和 `git diff --check` 通过. 自然语言为中文, 英文部分为精确命令, 路径和标识符.
- 非测试源码新增 8 行, 删除 11 行, 净减少 3 行, 满足预算.

## Comments

- 2026-11-01: H33, H34 和 H36 按既有授权移至 issue:0022:20, 当前 needs-triage, 本轮未实施. H37 的 identity 是导出的 Repository 类型和 resolveRepository 返回值的一部分, 删除会改变公开 Interface, 按原边界跳过. 本轮仅实施 H35, 没有更改 Reviewer 规则或审核语义.
- 第 1 轮 Code Standards 和要求符合 Reviewer 均正常完成, 报告均为 No problems. Main Agent 抽查 temporaryWritten 条件未变, 并回归核对替换拒绝时原始错误, 文件内容和权限及临时文件清理的既有断言, 未发现漏检. 本轮之后只补充本章记录.
