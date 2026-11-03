# JIRA 冗余条件清理

Status: completed

## What to build

本 issue 属于同一 effort 的三组死代码和重复删除任务. 处理 triage 的 Issue A (#17, #21, #22, #24, 可选 #18): 删除已由分页校验保证的条件, 简化状态判断, 删除已归一化 created 的空值回退, 保留 issue.key 回退. #22 跳过: 长期规范的 JIRA Convergence Interface 明确包含阶段输入, 因而保留 phase 类型, 调用和测试参数.

预计非测试代码净减少约 8 行, 净增预算为 0 行. 仅修改清单列出的实现及必要测试. 行为保持不变; 发现会改变 CLI 输出, 公开接口或持久状态的条目时跳过并记录. 不修改 lib/background-agent/**, 不安装, 不推送, 不访问克隆之外的工程或安装文件.

预期验证: 定向测试 tests/application-jira/jira-convergence-adapter.test.mjs tests/application-jira/jira-convergence.test.mjs, 新增或语义修改测试的回调不超过 100 毫秒, 完整 Source Checkout 验证 (pnpm test, pnpm typecheck, 三个分发生产检查脚本, 受影响文件 node --check, text check, terms check, git diff --check), Spec Readiness 和 Commit Audit.

相关边界: 在 findComment 中覆盖 startAt === total 且 comments 为空时返回 found: false; 保留无效分页拒绝, 状态校验, 评论排序及 CLI 输出.

## Acceptance criteria

- [x] 通过 git diff 核对清单范围内的安全删除, 在 Validation 记录跳过项及理由, 行为和既有合同保持不变.
- [x] 运行 What to build 中指定的边界测试和完整 Source Checkout 验证并记录通过结果, 测量新增或语义修改回调的耗时.

## Blocked by

- None - can start immediately

## Comments

就绪审核指出 #22 会删除规范已声明的接口输入; Main Agent 独立核对后确认, 按用户要求跳过此条, 不更改长期规范.

## Validation

完成 #17, #21, #24, 可选 #18; 非测试代码净减少 2 行. #22 跳过, 因为治理规范明确把阶段列入 JIRA Convergence Interface, 删除 phase 会改变既定接口. 调用和测试参数保留. 自查仅做删减和合并, 无额外范围. 抽查确认非法空分页仍失败, 用 total 边界终止分页仍返回 found: false, 保留 issue.key 的空值回退.

定向验证通过: node tests/application-jira/jira-convergence-adapter.test.mjs (4/4), node tests/application-jira/jira-convergence.test.mjs (2/2), node tests/application-jira/jira-client.test.mjs (2/2). 新增空耗尽页案例回调 0.608 毫秒.

完整 Source Checkout 验证通过: pnpm test (沙盒外, 807/807), pnpm typecheck, node scripts/check-workflow-distribution.mjs, node scripts/project-claude-skills.mjs --check, node scripts/generate-install-arw.mjs --check, 受影响四个文件 node --check, node arw.mjs text check, node arw.mjs terms check --include .scratch/0017-triage-dead-code/, git diff --check.

Commit Audit 第 2 轮的 Code Standards 和要求符合审核均为 No problems. Main Agent 回归抽查确认先验证来源或目标状态再决定是否转换, 评论分页越界仍被前置校验拒绝, phase 继续属于接口.
