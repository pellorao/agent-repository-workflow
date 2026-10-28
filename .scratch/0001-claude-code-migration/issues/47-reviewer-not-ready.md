# `--wait` 在运行退出而没有 completion 时不再报告成功

Status: completed

## What to build

用户批准的待办 (2026-10-29): 空 Reviewer 报告每次约损失 40 分钟 (实施 issue 37, 40, 42, 46 都发生过). 已有防线: `reviewer-runtime` 把缺失或空报告标为 `incomplete`; `spec-readiness generate` 拒绝空草稿; `commit-audit verify` 要求非空 `review.txt`. 缺口: `arw background-agent --wait` 在运行环境退出而 `completion` 为空时 (`lib/background-agent/machine.mjs` 的 `:done` 行), 仍输出 `ok: true`, Main Agent 会误以为审核完成.

交付内容:

- `machine.mjs`: `--wait` 的收尾在 `completion` 为空, 没有 `provider-program` 暂停通知, 且不是调用方自己取消等待 (`value.cancelled && waiting.signal.aborted`) 时, 输出失败响应 `{id: "<请求 id>:done", ok: false, error: {code: "reviewer-not-ready", message}}`; `message` 含运行状态与 `providerError`, 并说明审核未完成; 机器入口不规定调用方怎样重跑. 暂停通知路径, 调用方取消路径, 有 `completion` 的路径和等待失败路径不变: 单次 `wait_agent` 返回失败时仍优先输出 `{id: "<请求 id>:done", ok: false, error}`, `error` 原样取自该失败响应.
- 长期规格 `docs/specs/agent-repository-workflow/spec.md` 的 `Machine entry` 补这一失败响应 (已在设计定稿时修改: 失败响应形状, 等待失败优先, 不保留 `ok: true` 加空 `completion` 的理由与代价, 以及 `ADR Evaluation` 补 "不需要新 ADR" 的结论).
- `tests/background-agent/machine.test.mjs` 新增一个模拟用例: 运行环境退出且 `completion` 为空, 无暂停通知时, `:done` 为 `ok: false` 且 `error.code` 为 `reviewer-not-ready`; 既有的暂停通知用例 (`b:done`, `completion` 为 `null`) 与 "stray cancelled" 用例继续通过, 不修改它们.

终态: Main Agent 读 `:done` 行即可区分 "审核完成" 与 "审核没有结果", 不再把无 `completion` 的退出当成成功去读空报告.

不做: 不改 `reviewer-runtime` 的 `incomplete` 判定, `spec-readiness generate`, `commit-audit verify` (已有防线); 不自动重试, 重跑由 Main Agent 按错误信息执行.

预估净增 (代码 / 测试 / 文档): 代码约 +7, 测试约 +11, 总约 +18 行 (spec 改写既有句子).

## Spec Requirement

Governing requirements:

- `docs/specs/agent-repository-workflow/spec.md#machine-entry`
- `docs/specs/agent-repository-workflow/spec.md#adr-evaluation`
- `docs/specs/agent-repository-workflow-development/spec.md#validation-strategy`

## Acceptance criteria

- [x] `--wait` 在 `completion` 为空, 无 `provider-program` 暂停通知且调用方未取消时输出 `ok: false`, `error.code` 为 `reviewer-not-ready`, `message` 含运行状态. 观察: `tests/background-agent/machine.test.mjs` 新增用例通过.
- [x] 暂停通知, 调用方取消, 有 `completion` 和等待失败路径的响应不变. 观察: 同文件既有用例 (`--wait follows each accepted Reviewer task ...`, `--wait keeps waiting after a stray cancelled ...`) 未被修改且通过.
- [x] 长期规格 `Machine entry` 与实现一致. 观察: `grep -n reviewer-not-ready docs/specs/agent-repository-workflow/spec.md lib/background-agent/machine.mjs` 两处都有.
- [x] `pnpm test`, `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `arw text check`, `git diff --check` 通过.
- [x] 净增不超过估算的一倍. 观察: `git diff --numstat` 汇总.

## Blocked by

- None - can start immediately

## Validation

- Spec Readiness: 5 轮 haiku high (修剪 spec 后另有第 6 轮复审 `No problems.`). 第 1 轮 4 个问题: 等待失败与空 `completion` 的优先级未定义; 通用机器入口承担 "重跑指引" 的责任归属不清; Skill 对 `incomplete` 的表述与规格 `incomplete` 合同冲突; `commit` Skill 一句无对应要求 (已移出 subject, 两句 Skill 改动按 Agent 规则变更记在 `## Comments`). 第 2 轮 3 个问题: 规格里 "Main 的工作流规则" 悬空; "`ok: true` 总表示" 的保证与取消路径不符; `ADR Evaluation` 缺结论 (均已修正, 新增 `#adr-evaluation` 引用). 第 3, 4 轮 Reviewer 重复引用第 2 轮已删除的规格句子, 第 5 轮以质疑消息指出该句在快照中不存在后 `No problems.`; `arw spec-readiness verify --issue issue:0001:47` 退出 `0`. 实施在就绪审核完成后才开始 (未重复 issue 46 的偏离).
- `pnpm test` 793 项, 792 通过 (1 项既有跳过), `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `arw text check`, `git diff --check` 通过. 新增用例回调约 0.5 毫秒.
- 净增 (`git diff --cached --numstat -- lib tests docs`, 提交审核修复后): 代码 +12/-3, 测试 +18, spec +3/-1, 净 +29 (估算 +18, 未超一倍). 两句 Skill 各为改写既有行, 在源码, 投射与分发副本中各 +1/-1.
## Comments

- 配套 Agent 规则 (Main 指定, 只改规则, 按 `implement` Entry 第 5 步不安排就绪审核): `reviewer-launch` Skill 的 `Review rounds` 第 2 项补 `reviewer-not-ready` 与 "`reviewer-not-ready` 和 `incomplete` 都不是审核结果, 重派时重新 `prepare` 后重跑" (`incomplete` 仍由 Main 决定重派或结束); `commit` Skill 实施流程第 5 步补 "复审报告中写明仍成立且本轮变化没有解决它的旧问题, 若已在 issue 的 `## Comments` 记录处置, 不再重新分流". 投射与分发副本已同步. 第 1 轮就绪审核曾把这两句放在 subject 内并指出缺少对应要求, 移出后 subject 只含机器入口行为.
- Main 与独立 subagent 共同复核 spec 改动后修剪两处 (Machine entry): 把 "不保留 `ok: true` 加空 `completion` 的原因" 改为 "运行退出且没有结果时不返回 `ok: true`, 因为调用方会把它当作审核完成而去读空报告" (暂停与调用方取消路径仍返回 `ok: true` 加空 `completion`, 原写法不实); 删除 "等待失败" 后与后文定义重复的括号. `ADR Evaluation` 段不变. 修剪后第 6 轮就绪复审 `No problems.`, `verify` 退出 `0`. `reviewer-launch` Skill 句子已由 Main 缩短, 各副本已同步.
- 提交审核第 1 轮 (requirements 2 个, code-standards 3 个问题, 均采纳): `reviewer-launch` 句子漏写 "重派时", 与 spec 的 `incomplete` 合同冲突, 已补; spec Machine entry 的 "不返回 `ok: true`" 漏写调用方取消例外, 已补 "(调用方自己取消等待除外)" (spec 字节变化, 就绪复审后记录更新); `machine.mjs` 收尾改为按 失败, 成功, 未就绪 三路显式 if 链, 局部变量 `cancelled` 改名 `abortedByCaller`; `commit` Skill 那句不再依赖固定标签 "本轮未变", 改为引用 `reviewer.md` 复审规则已要求的 "写明本轮变化为何没有解决".
- 提交审核第 2 轮 (requirements 1 个, code-standards 1 个问题, 均采纳): `## Validation` 的净增数字过时, 已按受审版本更新; spec Machine entry 用 "上述情形不返回 `ok: true`" 取代重述触发条件 (只留理由), 删去与前句重复的条件. spec 字节变化, 就绪复审后记录更新.
