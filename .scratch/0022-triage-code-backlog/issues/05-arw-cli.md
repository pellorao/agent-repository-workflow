# 命令入口局部清理

Status: completed

## What to build

本 issue 属于 effort 0022, 处理 `.tmp/triage.md` 的 H23-H27. 已重新核对源码与调用方, 按用户授权实施下列行为保持清理.

- H23: 用文件内私有 openRepositoryFilesystem 合并四处完全相同的文件系统打开及失败处理, 保留打开时点和错误消息.
- H24: promoteSpecReadiness 的两个返回分支均使用 assertSafeWriteTarget 产生仓库内绝对路径, 删除 CLI 中不可达的越界失败分支, 使用 relative 转换展示路径. resolveAbsolutePathWithinScope 仍被 repositoryInputPath 使用, 保留导入.
- H25: 用文件内 APPLICATION_JIRA_COMMAND_KINDS 集合合并八个命令的重复分类比较, 不修改调用方类型.
- H26: 合并三个 Spec Readiness 分支完全相同的默认依赖对象表达式.
- H27: 作为同文件配套格式整理, 给 jl/jo 条件加括号, 保持运算优先级不变.

行为保持重构例外: 只删除死代码或不可达分支, 或合并完全相同的重复实现; 命令输出, 公开 Interface, 错误结果和持久状态不变; 不改变 Module 责任, Interface, Seam, 依赖方向, 权威来源或数据流; 不改动长期规范. 不运行 Spec Readiness, 提交审核照常运行.

体积预算: 非测试源码净增不超过 10 行. 只做当前清理, 不修改 `lib/background-agent/**`, 不安装, 不 push. 命令输出, 公开 Interface, 错误结果和持久状态保持不变; 需要类型收窄级联, 新诊断码或规范变更的发现跳过并记录.

预期验证: `node --test tests/arw-entry.test.mjs tests/arw-common/artifact-cli.test.mjs tests/application-jira/cli.test.mjs tests/spec-readiness/cli.test.mjs`, `pnpm test`, `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `node arw.mjs text check`, `node arw.mjs terms check --include .scratch/0022-triage-code-backlog/` 和 `git diff --check`. 定向文件路径在实施时核对, 不存在时选择该模块实际测试.

相关边界: 文件系统打开失败, 所有 JIRA 命令路由, 提升路径分隔符, Spec Readiness 依赖注入.

## Acceptance criteria

- [x] 已确认的范围完成, 已修复或不适用项明确记录, 可观察行为和公开合同不变.
- [x] 取得预期验证通过证据, 原有边界覆盖继续通过.

## Blocked by

- None - can start immediately

## Validation

- H23: 四个调用位置仍在原分支内打开相同 root, 失败时仍抛出相同消息. Artifact print 与 Spec Readiness CLI 的既有成功和失败覆盖继续通过.
- H24: 已核对 promoteSpecReadiness 两条返回路径的 target 均来自 assertSafeWriteTarget. 输出仍为仓库相对路径, 使用 sep 转为正斜杠; repositoryInputPath 的外部输入安全检查保留.
- H25-H27: 集合精确保留原八种命令, 默认依赖对象仍传入相同三个 Spec Readiness 操作, jl/jo 解析优先级不变. 既有 JIRA 路由, 别名和依赖注入测试通过.
- 定向命令通过, 共 4 个测试文件. `pnpm test` 通过, 共 814 个测试, 0 个失败. 未新增或语义修改测试.
- `pnpm typecheck`, 三个分发与投影脚本, `node --check lib/arw.mjs` 通过.
- `node arw.mjs text check`, `node arw.mjs terms check --include .scratch/0022-triage-code-backlog/` 和 `git diff --check` 通过.
- 非测试源码新增 23 行, 删除 23 行, 净增 0 行, 满足预算.

## Comments

- 2026-11-01: 按用户授权筛查 H23-H27 后实施一个 issue, 全部完成, 无跳过项. 未修改 Reviewer 规则, 无需能力测试.
- 第 1 轮 Code Standards 和要求符合 Reviewer 均正常完成, 报告均为 No problems. Main Agent 抽查集合与原八种命令逐项一致, 以及正常和例外提升仍由 assertSafeWriteTarget 确定仓库内目标的既有安全保证, 未发现漏检. 本轮之后只补充本章记录.
