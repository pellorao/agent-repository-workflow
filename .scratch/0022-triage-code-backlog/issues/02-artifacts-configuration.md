# 制品与配置重复清理

Status: needs-triage

## What to build

本 issue 属于 effort 0022, 处理 `.tmp/triage.md` 的 H6-H11. 实施前重新核对源码与全部调用方, 已修复项记为跳过. 当前仅完成分组规划, 不授权生产修改. 完成筛查后将确认范围和就绪审核或重构例外写在本章, 再更新状态.

- H6: 筛查 jira-client.mjs 与 jira-convergence-adapter.mjs 的重复 jira-response-invalid 结果是否能在不改变公开边界时合并.
- H7-H9: 合并 lib/arw-common/artifacts.mjs 的重复诊断文字, 删除 issuesRelativePath 别名, 合并 map 与 spec 查询分支.
- H10: 简化 lib/arw-common/codex-configuration.mjs 的 bytes 嵌套条件.
- H11: 核对并删除 lib/arw-common/issue-documents.mjs 的重复路径匹配分支.

体积预算: 非测试源码净增不超过 20 行. 只做当前清理, 不修改 `lib/background-agent/**`, 不安装, 不 push. 命令输出, 公开 Interface, 错误结果和持久状态保持不变; 需要类型收窄级联, 新诊断码或规范变更的发现跳过并记录.

预期验证: `node --test tests/arw-common/*.test.mjs tests/application-jira/jira-client.test.mjs tests/application-jira/jira-convergence-adapter.test.mjs`, `pnpm test`, `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `node arw.mjs text check`, `node arw.mjs terms check --include .scratch/0022-triage-code-backlog/` 和 `git diff --check`. 定向文件路径在实施时核对, 不存在时选择该模块实际测试.

相关边界: 符号链接, 非普通文件, 读取失败, map/spec 缺失, BOM, 默认配置和跨 effort issue 路径.

## Acceptance criteria

- [ ] 已确认的范围完成, 已修复或不适用项明确记录, 可观察行为和公开合同不变.
- [ ] 取得预期验证通过证据, 原有边界覆盖继续通过.

## Blocked by

无.
