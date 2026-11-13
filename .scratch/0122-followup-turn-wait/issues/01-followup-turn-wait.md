# 等待普通后台 Agent 的后续回合

Status: completed

## What to build

在 `tests/background-agent/manager.test.mjs` 复现 T2: 普通 Agent 的前一回合已结束, 接受 `followup_task` 后立即按 `machine.mjs` 使用 `cursor: 0` 和较长超时调用 `wait_agent`, 后续回合保持未完成. 分别运行通常调度和确定阻塞准备或交付的序列. 复现成功时, 用最小实现修复旧结束状态提前结束等待的问题, 保留回归覆盖并验证准备或交付失败的状态恢复. 未复现时记录确切序列及观察结果, 只保留增加独立覆盖的测试.

预计净增: 非测试代码 0 到 20 行, 测试约 60 行, issue 文本约 40 行 (文档预算 2400 字符). 若最小修复需要超过约 40 行非测试代码, 新的持久状态或公开 Interface, 以复现记录和修复建议交付.

预期验证: 定向管理进程测试, full Source Checkout validation and Commit Audit, then commit. 边界包括已结束回合, 延迟准备或交付, 后续回合尚未结束, 准备或交付失败, 以及既有 Reviewer 完成和 `reviewer-not-ready` 行为.

## Acceptance criteria

- [x] 记录通常调度和确定延迟序列的复现结果.
- [x] 复现成功且符合预算边界时, 等待结果不会把前一回合的结束误作后续回合的结束; 后续回合结束后可正常观察结束.
- [x] 修复覆盖准备或交付失败, 状态不会永久停留在正在工作; 未复现或超过修复边界时提供明确的记录和证据.
- [x] 既有 Reviewer 完成, `reviewer-not-ready`, 其他输出和退出码保持原合同.

## Blocked by

- None - can start immediately

## Validation

```text
code: +6 lines (files: 1)
  lib/background-agent/manager.mjs +6
documents: 0 characters (files: 0)
tests: +105 lines (files: 1)
  tests/background-agent/manager.test.mjs +105
next ADR number: 0041
```

- 未改生产代码时运行 `node --test --test-isolation=none --test-name-pattern='followup_task wait observes' tests/background-agent/manager.test.mjs`: 通常调度通过, 阻塞第二次 `startTurn` 的交付序列失败, 首次 `cursor: 0` 观察返回旧 `ended`. 序列: 启动普通 Agent, 等初始交付, 结束初始回合, 接受后续任务并保持未结束.
- 修复后六个定向用例通过, 每例约 5 到 14 毫秒. 通常和延迟交付都观察到非 `ended`, 新回合工作时继续等待, 新回合结束后观察 `ended`. 准备失败保留既有状态, 原生交付失败返回 `unknown`, 均无残留工作状态.
- `pnpm typecheck`, `pnpm test` 通过, 完整套件 963 例通过. 分发生产检查, Claude Skill 投影检查, 安装引导脚本生成检查, 两个改动文件的 `node --check`, 文本检查, 当前 effort 术语检查和 `git diff --check` 均通过.
- 回归核对: Reviewer 仍由独立运行时接受任务, `completion` 和 `reviewer-not-ready` 分支未改. 完整套件包含两平台既有覆盖; 未运行安装或真实普通 Agent 端到端流程.

## Comments

- Main 于 2026-11-14 授权本轮仅处理 T2, 单 effort 单 issue, 不需要新的治理设计, 经例外流程记录 Spec Readiness `not-applicable`. 授权修改 `lib/background-agent/manager.mjs`, 如等待循环更小则可改 `machine.mjs`, 及 `tests/background-agent/` 测试. 复现后恢复 0120 合同和用户决定 #362 的 A 选项: `followup_task --wait` 等待本次后续回合结束. Main 判定普通 Agent 控制面时序修复不属于 Reviewer 运行时修改, 不运行能力 A/B 或盲裁. 未复现时接受记录交付并走非实施提交.
- Main 于 2026-11-12 作出且本轮预先授予的门禁裁决: issue 自身要求矛盾时允许精确改写并通过正常命令刷新例外记录, 同线程下一轮只审核改写, 第 3 轮后亦可; 若验收依赖提交本身, 先提交已审核实现再用非实施提交补勾并记真实提交号; 原 Reviewer 线程无法恢复时新建线程对完整候选进行双轴审核并记录原因.
- 实施选择: 从既有 `pendingWork` 推导普通 Agent 的等待观察状态, 排队工作未完成时将旧 `ended` 观察为 `not-started`, 恢复前的旧 `exited` 观察为 `starting`, 同时让等待阻塞并在排队工作结束时唤醒. 保留存储中的任务状态和时间戳, Reviewer 角色沿用原始状态及唤醒路径. 无新增持久字段或公开 Interface, 等待循环未改.
- 首次双轴审核发现旧方案的失败回滚会覆盖较新已接受任务, 以及清空结束时间会让历史耗时增长. Main 独立复现前项失败, 增补排队失败与历史耗时覆盖, 以等待观察逻辑替换接受时更新及失败回滚. 六个用例均通过, 每例约 5 到 13 毫秒; 未改变 issue 要求.
- 预计与实际净增: 代码预算 0 到 20 行, 实际 6 行; 测试预算约 60 行, 实际 105 行, 增量来自审核指出的排队失败, 耗时和卸载后恢复回归覆盖; issue 文本预算约 40 行和 2400 字符, 实际 51 行和 3507 字符, 超出 1107 字符, 原因是复现证据, 审核修复说明及恢复和台账记录; 已合并相关说明, 保留可复核证据. 引擎的 documents 统计不含 `.scratch` 记录.
- 要求符合审核补充指出恢复期间旧退出状态可能提前触发 `reviewer-not-ready`. Main 用结束并卸载原线程, 接受改变指令的后续任务并延迟准备的序列独立复现 `exited`, 增补回归覆盖, 由既有待处理工作推导恢复前的观察状态; 实际恢复与最终失败沿用原合同.

- 台账: `.scratch/0122-followup-turn-wait/issues/01-followup-turn-wait.md:11` 预期验证句中的普通英文整句, 记录不修. Main 核对该句确有语言混用, 但它仅涉及实施开始后的 issue subject 措辞, 按 `commit/fix-rounds.md` 的任意轮记录规则保留, 不影响验证含义或行为.
- 恢复记录: 本会话的 `commit-audit verify` 返回没有当前会话审核轮, 因此重新准备完整候选并启动完整双轴审核. 候选与上一会话第 3 轮受审树相同. 本次完整验证再次通过 963 例测试, 六个新增回归回调约 4 到 14 毫秒, 其余必要检查均通过.
- 提交审核: 本会话双轴均正常返回 `ready`, 要求符合报告为 `No problems.`, Code Standards 唯一措辞问题按上述台账处置. Main 抽查等待循环的结束判定和 Reviewer 角色过滤, 确认普通待处理工作不会暴露旧结束状态, Reviewer 的 `completion` 与 `reviewer-not-ready` 分支保持原样.
