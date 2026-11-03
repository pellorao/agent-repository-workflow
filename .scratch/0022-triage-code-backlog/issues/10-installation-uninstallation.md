# 安装卸载重复清理

Status: completed

## What to build

本 issue 属于 effort 0022, 处理 `.tmp/triage.md` 的 H50-H54. 实施前重新核对源码与全部调用方, 已修复项记为跳过. 已核对当前源码及调用边界, 本轮授权 H50-H52 和 H54 的局部清理. H53 删除保护后需要收窄公开卸载结果类型, 按本 issue 的类型边界保留原实现.

- H50: 核对运行时列表非空后删除 installation.mjs 重复 writeBoundary 赋值.
- H51: 合并 ReleaseEvidence 和 SourceDiagnostic 类型定义.
- H52: 简化 uninstallation.mjs 消息数据库路径的相对路径往返.
- H53: removed 分支运行时具有非空 summary, 但当前公开返回类型未表达此关联; 为保留公开 Interface, 跳过并保留原实现.
- H54: 内联单次调用 pathExists.

行为保持重构例外: 只删除死代码或不可达分支, 或合并完全相同的重复实现; 命令输出, 公开 Interface, 错误结果和持久状态不变; 不改变 Module 责任, Interface, Seam, 依赖方向, 权威来源或数据流; 不改动长期规范. 不运行 Spec Readiness, 提交审核照常运行.

体积预算: 非测试源码净增不超过 0 行. 只做当前清理, 不修改 `lib/background-agent/**`, 不安装, 不 push. 命令输出, 公开 Interface, 错误结果和持久状态保持不变; 需要类型收窄级联, 新诊断码或规范变更的发现跳过并记录.

预期验证: `node --test tests/installation/*.test.mjs`, `pnpm test`, `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `node arw.mjs text check`, `node arw.mjs terms check --include .scratch/0022-triage-code-backlog/` 和 `git diff --check`. 定向文件路径在实施时核对, 不存在时选择该模块实际测试.

相关边界: 安装失败阶段, 平台模式, 消息数据库清理, 空目录, 卸载取消与已移除结果.

## Acceptance criteria

- [x] 已确认的范围完成, 已修复或不适用项明确记录, 可观察行为和公开合同不变.
- [x] 取得预期验证通过证据, 原有边界覆盖继续通过.

## Blocked by

- None - can start immediately

## Validation

- H50: loadInstallationPayload 要求 runtimeFiles 和各平台启动器列表非空, 成功载荷循环已设置 writeBoundary, 删除后续重复赋值. H51: 复用 release.mjs 已有且结构相同的类型, 保留本模块类型名称及 SourceResult 联合结构.
- H52: 消息数据库路径保留相对形式, 安全检查及删除时转为原有完整路径, 空目录清理直接使用相对路径. H54: 内联单次 inspect, 保留 installation.exists 短路及原始错误消息. 既有卸载测试覆盖配置保留与删除, 数据库清理, 未知残留和取消.
- 定向安装模块测试提权复跑通过, 共 106 个测试, 0 个失败; 沙盒内停滞的定向运行已停止. 完整 pnpm test 通过, 共 814 个测试, 0 个失败. 未新增或语义修改测试.
- pnpm typecheck, 三个分发与投影脚本, 两个受影响源码的 node --check, text check, 当前 effort 的 terms check, issue 的 language inspect 和 git diff --check 均通过.
- 非测试源码新增 17 行, 删除 22 行, 净减少 5 行, 满足 0 行预算. 提交前删减自查未发现其他必要合并.

## Comments

- 2026-11-01: H53 的运行时 removed 结果确有非空 summary, 但公开返回类型未形成判别联合, 删除保护需要收窄其类型合同. 按本 issue 的公开 Interface 和类型边界跳过, 保留原实现.

- 第 1 轮 Code Standards 和要求符合 Reviewer 均正常完成, 报告均为 No problems. Main Agent 抽查 loadInstallationPayload 的非空 runtimeFiles 与启动器约束, 循环成功后已有 writeBoundary; 回归核对消息数据库四种固定路径的转换和既有卸载测试, 确认配置保留时数据库保留, 删除时只移除数据库及附属文件, 未知文件保留. 本轮之后仅补充本章记录.
