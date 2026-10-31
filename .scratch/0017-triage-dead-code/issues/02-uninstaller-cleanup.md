# 卸载重复实现清理

Status: completed

## What to build

本 issue 属于同一 effort 的三组死代码和重复删除任务. 处理 triage 的 Issue B (#236, #237, #242, #240): 将重复的 prepareInstallationFilesystem 合并到 installation-contract.mjs 供两个内部调用者复用, 删除重复 manifest 空值检查和不可达 prompt 检查, 从 messageDatabasePaths 推导空目录清理输入, 不重复硬编码布局.

预计非测试代码净减少约 24 行, 净增预算为 0 行. 仅修改清单列出的实现及必要测试. 行为保持不变; 发现会改变 CLI 输出, 公开接口或持久状态的条目时跳过并记录. 不修改 lib/background-agent/**, 不安装, 不推送, 不访问克隆之外的工程或安装文件.

预期验证: 定向测试 tests/installation/uninstallation.test.mjs, 新增或语义修改测试的回调不超过 100 毫秒, 完整 Source Checkout 验证 (pnpm test, pnpm typecheck, 三个分发生产检查脚本, 受影响文件 node --check, text check, terms check, git diff --check), Spec Readiness 和 Commit Audit.

相关边界: 使用隔离夹具证明空 background-agent-state 随安装目录被移除; 保留非空目录, 配置删除授权, 清单和路径归属, 不访问真实安装.

## Acceptance criteria

- [x] 通过 git diff 核对清单范围内的安全删除, 在 Validation 记录跳过项及理由, 行为和既有合同保持不变.
- [x] 运行 What to build 中指定的边界测试和完整 Source Checkout 验证并记录通过结果, 测量新增或语义修改回调的耗时.

## Blocked by

无.

## Validation

完成 #236, #237, #242, #240, 本组无跳过项. 非测试代码净减少 20 行. 共用函数保留原函数体和默认文件系统; 路径清理从既有 messageDatabasePaths 去掉 installationPath 前缀后取得相同的目录, 未增加删除对象或授权. 类型断言仅表达前置检查已经保证的非空事实. 自查仅做删除与合并.

定向验证 node tests/installation/uninstallation.test.mjs 在沙盒外通过 25/25. 新增空状态目录案例回调 7.509 毫秒, 同时保留非空目录和消息数据库授权覆盖. 首次沙盒内真实 CLI 夹具因 loopback listen EPERM 失败, 沙盒外重跑通过. 所有安装和卸载均使用隔离夹具, 未触及真实安装.

完整 Source Checkout 验证通过: pnpm test (沙盒外, 808/808), pnpm typecheck, node scripts/check-workflow-distribution.mjs, node scripts/project-claude-skills.mjs --check, node scripts/generate-install-arw.mjs --check, 受影响四个文件 node --check, node arw.mjs text check, node arw.mjs terms check --include .scratch/0017-triage-dead-code/, git diff --check.

## Comments

就绪审核最初质疑空状态目录清理的授权. Main Agent 引用绑定实现中原已无条件执行的同一清理交回核对, Reviewer 确认这是既有副作用并撤回问题, 最终为 No problems.

Commit Audit 第 3 轮的 Code Standards 和要求符合审核均为 No problems. Main Agent 回归抽查确认共用函数保持原函数体, 默认文件系统和错误, 空目录路径仍来自相同安装内目录, 配置和数据库删除仍受 removeConfig 控制. Gate 2 的 documents 为空, 无新增规范差异.
