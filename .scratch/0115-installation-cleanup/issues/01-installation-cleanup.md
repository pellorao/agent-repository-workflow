# 安装与工作流锁重复代码清理

Status: completed

## What to build

处理 `.tmp/triage.md` 的 Issue M, 只实施逐项核实后保持行为的部分. 合并卸载交互的重复异常处理, 复用已安装文件集合, 删除冗余条件与可选访问, 将工作流锁内部调用统一到 `verifyManagedTargets` 并删除未使用的 `repositoryRoot` 参数. 安装失败分支仅在所有实际生产者都带错误诊断时删除重复状态判断. 保留所有输出, 退出码与持久状态.

规模预算: 非测试代码预计净减少 25 行, 测试预计净增 0 行, issue 文本预计新增 1900 字符. 原分流预计删除约 90 行, 核实后的行为约束优先.

边界情况: 缺失或非普通文件的 `package.json`, 交互期间配置硬链接变化, 未提供提示函数, 提示抛错, 取消卸载, 已卸载, 部分失败与未知状态, 配置保留或重建, 工作流锁文件漂移. 不改变上述结果, 不修改 `registeredMigrators` 或后台 Agent 实现.

预期验证: 现有安装, 卸载与工作流锁测试; 完整 Source Checkout 验证, 包括 `pnpm typecheck`, `pnpm test`, 分发检查, Claude Code 投影检查, 引导脚本检查, 受影响文件语法检查, 文本与术语检查及差异空白检查. 通过双 Reviewer 的 Commit Audit 后提交.

## Acceptance criteria

- [x] 每项候选核实调用链, 生产者和现有测试, 不成立或改变行为的项目保留并记录原因.
- [x] 已确认的重复代码完成清理, 用户可见行为与持久状态保持一致.
- [x] 完整 Source Checkout 验证成功, 记录代码, 测试和文档的估算与实际规模.

## Blocked by

- None - can start immediately

## Validation

`pnpm typecheck` 通过. `pnpm test` 在允许本地回环套接字的环境中通过, 949 个测试全部成功, 无跳过或失败, 耗时约 3 秒. 沙箱内首次运行及定向运行被 `listen EPERM` 阻断, 未据此修改产品或测试.

`node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check` 全部通过. 对五个变更的 JavaScript 文件运行 `node --check` 通过. `node arw.mjs text check`, `node arw.mjs terms check --include .scratch/0115-installation-cleanup/`, `git diff --check` 通过. `node arw.mjs language inspect` 确认 issue 普通叙述为中文.

现有安装测试覆盖本地源缺失, 配置链接拒绝, 降级拒绝, 非交互错误与交互流程; 卸载测试覆盖取消, 已卸载, 交互顺序与后台 Agent 关闭失败; 工作流锁测试覆盖受管理内容保持及漂移. 测试只更名内部导入和调用, 无语义修改或新增用例. 生产者检查确认安装失败均携带错误诊断, 卸载失败在统一 catch 中加入错误诊断, 因而删除状态判断不删除有效成功或失败路径.

估算代码净减少 25 行, 测试净增 0 行, issue 文本新增约 1900 字符; 实际代码净减少 23 行, 测试净增 0 行, issue 与就绪记录文档规模由 Commit Audit 摘要记录. 保留 M1, M2 与 M4 提示函数检查的理由见 Comments.

```text
code: -23 lines (files: 4)
  lib/installation/installation.mjs -8
  lib/installation/uninstallation.mjs -13
  lib/repository-workflow/workflow-lock.mjs -2
  lib/repository-workflow/workflow.mjs 0
documents: 0 characters (files: 0)
tests: 0 lines (files: 1)
  tests/repository-workflow/workflow-lock.test.mjs 0
next ADR number: 0041
```

补充规模: issue 与就绪 JSON 新增 66 行; 代码新增 26 行, 删除 49 行; 测试新增 4 行, 删除 4 行. 审计的 documents 数字不计 `.scratch` 工作记录.

## Comments

用户明确授权本轮无设计决定, 每个 issue 单独 effort, 无 spec, 通过 Exception workflow 取得 `not-applicable` 记录. 确认于 2026-11-11T08:46:06Z 前取得.

核实处置: M1 保留, `readScopedBytes` 对缺失文件返回 `blocked`, 原实现返回 `failed` 且消息不同, 对目录的消息也不同. 删除检查会改变输出和结果. M2 保留, 配置检查后存在交互等待, `file-transaction.mjs` 的 `observe` 没有 `rejectHardLinks`, 因此后续检查仍防止新硬链接. M3 卸载 `unchanged` 在取消和已卸载时没有错误, 保留成功路径; 仅删除已由错误诊断覆盖的失败状态判断. M4 保留可选提示函数检查, 两个公开入口的选项允许缺省且测试调用未提供提示函数, 不能证明为死代码. M5 与 M6 确认重复及未使用字段成立, 仅工作流模块内部调用和对应测试使用别名. 实际代码比净减少 25 行的预算多 2 行, 因合并异常处理仍需保留可选提示检查及三个条件, 无必要进一步改写. Commit Audit 第 2 轮两个 Reviewer 均正常结束, 报告均为 `No problems.`. Main 抽查卸载取消仍返回 0 且不读取空摘要, 以及受管理文件漂移仍产生 `managed-content-drift`, 未发现漏检. 第 1 轮仅补充规模摘要, 未启动 Reviewer.
