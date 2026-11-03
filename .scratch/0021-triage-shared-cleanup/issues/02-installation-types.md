# 合并安装模块重复定义

Status: completed

## What to build

本 effort 按模块处理 .tmp/triage.md 的第 4 轮已确认清单, 按 issue 编号顺序推进. 当前 issue 非测试代码净增预算: 0 行. 允许删除或合并相同实现, 不增加行为. 发现行为, 输出, 公开合同或持久状态变化, 类型收窄传播或需修改规范时跳过对应项并记录. 未发现新增已确认项时不扩展范围.

- #84: 合并 arw-common/installation-manifest.mjs 与 installation/installation-contract.mjs 完全相同的清单类型, 另一处类型导入.
- #77: ConfiguredEditor 复用 ConfiguredCommand, 保留 isConfiguredEditor.
- #71: identity.mjs 复用 INSTALLATION_MANIFEST_FILE.
- #53: agent-cli-launch.mjs 在 code !== null 后删除恒真的 Number.isInteger 检查.
- #221: writeInstallationManifest 复用 compareText.
- #241: 仅在线数减少且错误消息相同时合并 parseUninstallArguments 的两个布尔选项分支.

行为保持重构例外: 只删除死代码或不可达分支, 或合并完全相同的重复实现; 命令输出, 公开 Interface, 错误结果和持久状态不变; 不改变 Module 责任, Interface, Seam, 依赖方向, 权威来源或数据流; 不改动长期规范.

预期验证: pnpm typecheck, pnpm test, node scripts/check-workflow-distribution.mjs, node scripts/project-claude-skills.mjs --check, node scripts/generate-install-arw.mjs --check, 受影响文件的 node --check, node arw.mjs text check, node arw.mjs terms check --include .scratch/0021-triage-shared-cleanup/, git diff --check. 使用现有覆盖, 只有发现独立回归风险缺口时新增最少测试. Commit Audit 使用两个内置 Reviewer.

边界情况: 正常及异常退出码, 清单顺序, 配置命令解析, 布尔选项缺值及无效值, 两种 Agent 平台现有确定性覆盖.

## Acceptance criteria

- [x] 逐项复核并完成可保持行为的精简, 跳过项记录理由.
- [x] 命令输出, 公开 Interface, 错误结果和持久状态不变, 不修改长期规范.
- [x] 完整 Source Checkout 验证及适用检查通过, 记录预算实际值和验收证据.

## Blocked by

- None - can start immediately

## Validation

- #84, #77, #71, #53, #221 和 #241 均完成, 没有跳过项. 类型定义和排序复用已有实现, isConfiguredEditor 保持原样, 正常退出码和空退出码处理保持原有结果.
- 非测试代码净增预算 0 行, 实际新增 16 行, 删除 25 行, 净减少 9 行. 只删减与合并自查完成, 未修改测试或长期规范.
- pnpm test 通过: 812 项测试, 0 失败; pnpm typecheck 通过. 现有覆盖检验安装清单, 身份解析, 编辑器与 Agent 启动以及卸载行为, 包含 Codex 和 Claude Code 的确定性覆盖.
- node scripts/check-workflow-distribution.mjs, node scripts/project-claude-skills.mjs --check 和 node scripts/generate-install-arw.mjs --check 均通过.
- 5 个修改的 JavaScript 文件均通过 node --check; node arw.mjs text check, node arw.mjs terms check --include .scratch/0021-triage-shared-cleanup/ 和 git diff --check 均通过.
- 使用 HEAD 中的原参数解析器与当前公开 parseUninstallArguments 比较长度 0 到 5 的参数序列, 覆盖两个布尔选项, 非交互选项, true, false, 无效值和未知选项, 返回值及错误消息完全一致.

## Comments

- Commit Audit 第 1 轮的 requirements-reviewer 和 code-standards-reviewer 均以 ready 完成, 报告均为 No problems. 审核对象树为 2a6c252266329f54d2df2b9e6e6c6020a8c36079.
- Main Agent 回归抽查了 tests/arw-common/agent-cli.test.mjs 的空退出码失败结果与 tests/installation/uninstallation.test.mjs 的重复选项, 缺值和无效值边界, 并核对共享 compareText 与原排序表达式相同. 参数解析对比共覆盖 19,608 组输入, 未发现遗漏或行为变化.
