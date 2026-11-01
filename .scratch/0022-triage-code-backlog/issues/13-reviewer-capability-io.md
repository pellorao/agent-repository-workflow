# 审查能力读写清理

Status: needs-triage

## What to build

本 issue 属于 effort 0022, 处理 `.tmp/triage.md` 的 H66-H70. 实施前重新核对源码与全部调用方, 已修复项记为跳过. 当前仅完成分组规划, 不授权生产修改. 完成筛查后将确认范围和就绪审核或重构例外写在本章, 再更新状态.

- H66: 使用 entries 获取 SPEC_READINESS_INPUT_ROLES 的前缀与角色.
- H67-H68: 删除 reviewer-capability-view.mjs 重复 diagnostics 后备和临时目录标记.
- H69: splitPool 读取一次文本供校验和解析.
- H70: operations.mjs 的 spill 文件读取一次字节供散列和解码.

体积预算: 非测试源码净增不超过 0 行. 只做当前清理, 不修改 `lib/background-agent/**`, 不安装, 不 push. 命令输出, 公开 Interface, 错误结果和持久状态保持不变; 需要类型收窄级联, 新诊断码或规范变更的发现跳过并记录.

预期验证: `node --test tests/reviewer-capability*.test.mjs tests/reviewer-capability/*.test.mjs`, `pnpm test`, `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `node arw.mjs text check`, `node arw.mjs terms check --include .scratch/0022-triage-code-backlog/` 和 `git diff --check`. 定向文件路径在实施时核对, 不存在时选择该模块实际测试.

相关边界: 无匹配输入角色, setup 失败, 临时目录创建失败和清理, 散列不符, spill 字节.

## Acceptance criteria

- [ ] 已确认的范围完成, 已修复或不适用项明确记录, 可观察行为和公开合同不变.
- [ ] 取得预期验证通过证据, 原有边界覆盖继续通过.

## Blocked by

无.
