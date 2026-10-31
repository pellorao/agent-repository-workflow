# 卸载重复实现清理

Status: ready-for-agent

## What to build

本 issue 属于同一 effort 的三组死代码和重复删除任务. 处理 triage 的 Issue B (#236, #237, #242, #240): 将重复的 prepareInstallationFilesystem 合并到 installation-contract.mjs 供两个内部调用者复用, 删除重复 manifest 空值检查和不可达 prompt 检查, 从 messageDatabasePaths 推导空目录清理输入, 不重复硬编码布局.

预计非测试代码净减少约 24 行, 净增预算为 0 行. 仅修改清单列出的实现及必要测试. 行为保持不变; 发现会改变 CLI 输出, 公开接口或持久状态的条目时跳过并记录. 不修改 lib/background-agent/**, 不安装, 不推送, 不访问克隆之外的工程或安装文件.

预期验证: 定向测试 tests/installation/uninstallation.test.mjs, 新增或语义修改测试的回调不超过 100 毫秒, 完整 Source Checkout 验证 (pnpm test, pnpm typecheck, 三个分发生产检查脚本, 受影响文件 node --check, text check, terms check, git diff --check), Spec Readiness 和 Commit Audit.

相关边界: 使用隔离夹具证明空 background-agent-state 随安装目录被移除; 保留非空目录, 配置删除授权, 清单和路径归属, 不访问真实安装.

## Acceptance criteria

- [ ] 通过 git diff 核对清单范围内的安全删除, 在 Validation 记录跳过项及理由, 行为和既有合同保持不变.
- [ ] 运行 What to build 中指定的边界测试和完整 Source Checkout 验证并记录通过结果, 测量新增或语义修改回调的耗时.

## Blocked by

无.
