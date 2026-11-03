# 合并公共实现与共享类型

Status: completed

## What to build

本 effort 按模块处理 .tmp/triage.md 的第 4 轮已确认清单, 按 issue 编号顺序推进. 当前 issue 非测试代码净增预算: 0 行. 允许删除或合并相同实现, 不增加行为. 发现行为, 输出, 公开合同或持久状态变化, 类型收窄传播或需修改规范时跳过对应项并记录. 未发现新增已确认项时不扩展范围.

- #189: 内联 common/git-content.mjs 中仅调用一次的 requireSuccess, 保留失败条件和错误文本.
- #110: 将使用 common/json.mjs 的 compareText 的 4 份 uniqueSorted 合并到该公共模块. workflow.mjs 的本地 compareText 使用 localeCompare, 与公共比较器不同, 保留其 uniqueSorted 并列为部分跳过.
- #188: 将与 common/git-process.mjs 完全相同的 GitProcessResult 和 GitRunner 改为类型导入. 保留较窄的 run 输入变体, 以及 text-policy.mjs 中 stderr 为 string | Buffer 的不同结果类型; 不进行类型收窄传播.
- #103: 以 common/document-language.mjs 的 LanguageComposition 为相同类型的定义, 其余两处改为类型导入.

行为保持重构例外: 只删除死代码或不可达分支, 或合并完全相同的重复实现; 命令输出, 公开 Interface, 错误结果和持久状态不变; 不改变 Module 责任, Interface, Seam, 依赖方向, 权威来源或数据流; 不改动长期规范.

预期验证: pnpm typecheck, pnpm test, node scripts/check-workflow-distribution.mjs, node scripts/project-claude-skills.mjs --check, node scripts/generate-install-arw.mjs --check, 受影响文件的 node --check, node arw.mjs text check, node arw.mjs terms check --include .scratch/0021-triage-shared-cleanup/, git diff --check. 使用现有覆盖, 只有发现独立回归风险缺口时新增最少测试. Commit Audit 使用两个内置 Reviewer.

边界情况: 空数组, 重复字符串, 大小写及非 ASCII 排序, Git 批量空输入及进程失败, stderr 的 Buffer 兼容性, 空文档比例和语言展示.

## Acceptance criteria

- [x] 逐项复核并完成可保持行为的精简, 跳过项记录理由.
- [x] 命令输出, 公开 Interface, 错误结果和持久状态不变, 不修改长期规范.
- [x] 完整 Source Checkout 验证及适用检查通过, 记录预算实际值和验收证据.

## Blocked by

- None - can start immediately

## Validation

- #189: readBatchBlobs 的进程失败条件和原错误文本逐字保留, 空输入和批量响应解析不变.
- #110: workflow-lock.mjs, code-map.mjs, repository-state-inspector.mjs 和 document-terms-repository.mjs 的相同实现合并为 common/json.mjs 的 uniqueSorted; 仍使用原 compareText 和 Set, 不改变去重或排序语义.
- #188: 4 份相同 GitProcessResult 和 repository.mjs 的相同 GitRunner 改为类型导入; 较窄输入和 text-policy.mjs 的 Buffer stderr 均保留. pnpm typecheck 通过.
- #103: 两处 LanguageComposition 改为类型导入, 运行时语言统计和展示代码不变.
- pnpm test 在允许本地监听的环境通过: 812 个测试通过, 0 个失败, 0 个跳过. 日志: .tmp/codex/01a19062-fbf4-76e1-a892-fdf3eeef4967/0021_01/validation/tests-unrestricted.log. 首次沙盒运行遇到本地监听 EPERM, 不作为有效通过结果.
- node scripts/check-workflow-distribution.mjs, node scripts/project-claude-skills.mjs --check, node scripts/generate-install-arw.mjs --check 和全部 10 个受影响文件的 node --check 均通过.
- node arw.mjs text check, node arw.mjs terms check --include .scratch/0021-triage-shared-cleanup/ 和 git diff --check 通过. 新 issue 的 language inspect 已检查, 普通叙述为中文, 英文均为精确字段, 标识符或命令.
- 非测试代码实际净增 -9 行 (新增 15, 删除 24), 未超出 0 行预算. 未新增或语义修改测试.

- 提交前回归抽查: 排序去重的空数组, 重复项, 大小写和非 ASCII 输入及不修改输入数组的检查通过; readBatchBlobs 的空输入不调用 Git, 非零退出, process 和 timeout 均保留原错误消息. 另一次包含 spawnSync git 的抽查受沙盒 EPERM 阻止, 上述完成检查直接调用公开函数取得有效结果.
- Commit Audit 第 1 轮: requirements-reviewer 与 code-standards-reviewer 均已取得 status 为 ready 的完成结果, 两份绑定报告均为 No problems. 报告目录: .tmp/codex/01a19062-fbf4-76e1-a892-fdf3eeef4967/_commit-audit/1/. Main Agent 已独立抽查相同排序实现及 Git 失败条件和消息, 未发现漏检.

## Comments

#110 部分跳过: workflow.mjs 的 compareText 使用 localeCompare(..., 'en'), 公共比较器使用码元顺序, 不能认为实现相同; 替换可能改变命令输出和持久锁顺序, 故保留. #188 的不同类型按原计划保留, 不触发类型收窄传播. 本 issue 满足行为保持重构例外, 不创建 Spec Readiness 记录.

审核收尾恢复: requirements-reviewer 报告目录出现 3 个空的 .codex, .git, .agents 目录, 引擎最初拒绝绑定. Main Agent 仅删除已确认为空的多余目录, 未修改报告字节或审核输入; 再经 arw background-agent 查询确认原运行 idle, completion.status 为 ready, providerError 为 null, 采用原绑定完整报告. 无需替代线程或语义复审.
