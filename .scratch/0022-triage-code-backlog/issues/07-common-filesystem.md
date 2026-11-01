# 公共文件系统与文档语言清理

Status: needs-triage

## What to build

本 issue 属于 effort 0022, 处理 `.tmp/triage.md` 的 H33-H37. 实施前重新核对源码与全部调用方, 已修复项记为跳过. 当前仅完成分组规划, 不授权生产修改. 完成筛查后将确认范围和就绪审核或重构例外写在本章, 再更新状态.

- H33: 删除 BodyFlow 未使用的 kind 字段, 同步文档语言检查调用方.
- H34: 筛查 filesystem.mjs 与 file-transaction.mjs 的重复 diagnostic 构造.
- H35: 合并临时文件 尽力清理.
- H36: 筛查 logicalPath 的复用并删除 repository.mjs 重复路径表达式.
- H37: 筛查 Repository.identity 删除是否影响公开 Interface, 影响则跳过.

体积预算: 非测试源码净增不超过 10 行. 只做当前清理, 不修改 `lib/background-agent/**`, 不安装, 不 push. 命令输出, 公开 Interface, 错误结果和持久状态保持不变; 需要类型收窄级联, 新诊断码或规范变更的发现跳过并记录.

预期验证: `node --test tests/common/*.test.mjs tests/arw-common/document-language-inspection.test.mjs`, `pnpm test`, `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `node arw.mjs text check`, `node arw.mjs terms check --include .scratch/0022-triage-code-backlog/` 和 `git diff --check`. 定向文件路径在实施时核对, 不存在时选择该模块实际测试.

相关边界: 文件事务失败与清理失败, 路径分隔符, 根目录, 文档正文筛选和仓库身份.

## Acceptance criteria

- [ ] 已确认的范围完成, 已修复或不适用项明确记录, 可观察行为和公开合同不变.
- [ ] 取得预期验证通过证据, 原有边界覆盖继续通过.

## Blocked by

无.
