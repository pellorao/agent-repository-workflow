# 仓库状态与配置清理

Status: needs-triage

## What to build

本 issue 属于 effort 0022, 处理 `.tmp/triage.md` 的 H17-H22. 实施前重新核对源码与全部调用方, 已修复项记为跳过. 当前仅完成分组规划, 不授权生产修改. 完成筛查后将确认范围和就绪审核或重构例外写在本章, 再更新状态.

- H17: 筛查 repository-state-inspector.mjs 的 repositoryLocation 参数与 workflow.mjs 调用方, 公开合同有变化则跳过.
- H18-H19: 删除 uniqueSorted 前多余 Set 和 parseHeadTreeEntries 未使用的 type 字段, 保留 blob/commit 格式检查.
- H20: 用赋值替换 reviewer-configuration.mjs 已白名单筛选键的 defineProperty.
- H21: 简化 repository-configuration.mjs 的错误信息提取.
- H22: 合并 repository.mjs 的相同返回分支.

体积预算: 非测试源码净增不超过 0 行. 只做当前清理, 不修改 `lib/background-agent/**`, 不安装, 不 push. 命令输出, 公开 Interface, 错误结果和持久状态保持不变; 需要类型收窄级联, 新诊断码或规范变更的发现跳过并记录.

预期验证: `node --test tests/arw-common/*.test.mjs tests/repository-workflow/*.test.mjs`, `pnpm test`, `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `node arw.mjs text check`, `node arw.mjs terms check --include .scratch/0022-triage-code-backlog/` 和 `git diff --check`. 定向文件路径在实施时核对, 不存在时选择该模块实际测试.

相关边界: 未找到仓库, 缺失或非目录 scratch, Git tree 类型, 配置拒绝和审查角色字段.

## Acceptance criteria

- [ ] 已确认的范围完成, 已修复或不适用项明确记录, 可观察行为和公开合同不变.
- [ ] 取得预期验证通过证据, 原有边界覆盖继续通过.

## Blocked by

无.
