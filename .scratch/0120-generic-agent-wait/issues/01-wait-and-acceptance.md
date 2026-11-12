# 普通后台 Agent 回合结束等待与提交验收规则

Status: completed

## What to build

让 `arw background-agent --wait` 在普通后台 Agent 的 `wait_agent` 返回 `taskState: 'ended'` 且没有 Reviewer `completion` 字段时结束等待, 输出现有形状的 `<id>:done`, 保留 `completion: null`, 收集到的 `messages` 和 `providerError`. Reviewer 继续等待非空 `completion` 或现有暂停条件. 保留普通 Agent 的运行环境退出和失败结果, 包括 `reviewer-not-ready`. 用确定性测试证明普通回合结束后只取一次结束观察, 消除立即返回的等待造成的空转, 并证明 Reviewer 回合结束但 `completion: null` 时仍继续等待.

更新长期规范的 `--wait` 结束条件, 在 `reviewer-launch/machine-operations.md` 说明普通 `spawn_agent` 的五个必填设置和缺失时的现有错误, 以及普通回合结束等待的用法. 在 `issue-tracking/SKILL.md` 增加一句规则: 验收标准不包含以 Commit Audit 通过或提交本身为条件的条目, 由 `commit` 工作流保证这些事实并放入预期验证. 保留既有其他审核事实的验收规则. 同步分发副本与 Claude Code 投影, 在 Reviewer 能力待测表登记作者侧禁令.

体积预算: 非测试代码净增 15 行以内; 预计改动代码约 15 行, 测试约 60 行, issue 与文档约 75 行. 文档按自然段书写, 完成时分别记录预计与实际行数.

预期验证: 完整 Source Checkout 验证和 Commit Audit, 然后提交. 定向运行 `tests/background-agent/machine.test.mjs`, 覆盖普通 Agent 结束, Reviewer 结束但未完成, 消息累计, 退出和等待失败等边界; 两个平台共用机器入口, 用分发与 Claude Code 投影检查验证两端规则一致.

## Acceptance criteria

- [x] 普通 Agent 回合结束输出成功的 `<id>:done`, 保留全部消息与 `providerError`, 不重复等待已结束回合.
- [x] Reviewer 在回合结束且 `completion: null` 时继续等待, 既有完成, 暂停, 退出和失败行为通过确定性测试.
- [x] 规范与操作说明准确表达普通 Agent 的等待和必填设置合同, 分发副本与 Claude Code 投影同步.
- [x] issue 编写规则增加提交条件禁令, 保留其他审核事实规则, 能力待测表已有登记.

## Blocked by

- None - can start immediately

## Validation

- `node tests/background-agent/machine.test.mjs`: 10 个案例通过, 新增普通回合与 Reviewer 对照案例 0.963 ms, 修改的退出案例 0.400 ms, 新增等待失败案例 0.299 ms, 均低于 100 ms. 两种请求 `spawn_agent` 与 `followup_task` 的普通结束只等待一次, Reviewer `completion: null` 后仍等到真实完成; 现有完成, 暂停, 取消, 退出测试通过.
- `pnpm typecheck` 通过; `pnpm test` 完整套件通过, tests 956, pass 956, fail 0. `node --check lib/background-agent/machine.mjs` 和 `node --check tests/background-agent/machine.test.mjs` 通过.
- `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check` 通过, Codex 与 Claude Code 共用入口及规则投影均验证.
- `node arw.mjs text check`, `node arw.mjs terms check --include .scratch/0120-generic-agent-wait/`, `git diff --check` 通过. 新 issue 的 `arw language inspect` 为中文 84.3%, 英文 15.7%, 英文为精确字段, 路径和命令.
- 手工核对规范结束条件, 五个必填设置与 `manager.mjs` 的错误结果一致; 保留 issue-tracking 的其他审核事实规则, 待测表登记位置为第 21 行. 没有修改 `manager.mjs`.

候选实测摘要:

```text
code: +1 lines (files: 1)
  lib/background-agent/machine.mjs +1
documents: +1335 characters (files: 8)
  .agents/skills/issue-tracking/SKILL.md +66
  .agents/skills/reviewer-launch/machine-operations.md +310
  .claude/skills/issue-tracking/SKILL.md +66
  .claude/skills/reviewer-launch/machine-operations.md +310
  distribution/skills/issue-tracking/SKILL.md +66
  distribution/skills/reviewer-launch/machine-operations.md +310
  docs/agents/source-checkout-reviewer-testing.md +138
  docs/specs/agent-repository-workflow/spec.md +69
tests: +50 lines (files: 1)
  tests/background-agent/machine.test.mjs +50
next ADR number: 0041
```

## Comments

- 本轮授权来自 `.tmp/triage.md` Issue T 及用户本轮指示, 两项合并为单 issue effort, 没有剩余设计决定, 无 effort spec, 使用 Spec Readiness `not-applicable` 例外. Main 确认长期规范, Agent 指令与投影的所述编辑, 适用 Source Checkout Baseline 例外.
- Main 本轮允许改动 `lib/background-agent/machine.mjs` 和 `tests/background-agent/`, 必要时才修改 `manager.mjs`. 用户决定 #362 授权普通 Agent 回合结束时返回, 其他输出与退出码保留. 不修改用户手册和安装文件.
- Main 裁定两项均非 Reviewer 运行时改动: 第一项为控制平面等待循环, 第二项为作者侧禁令. 登记第二项待测, 本轮不运行能力 A/B 或盲裁.
- Main 于 2026-11-12 作出并在本轮预授权的关卡处置: 审核发现 issue 自身要求自相矛盾时可只修正措辞, 通过正常命令刷新例外记录, 下一轮原 Reviewer 线程只审核该修正, 第 3 轮及以后同样适用; 如验收项依赖提交本身, 先提交受审实现, 再用非实施提交勾选并记录真实提交号, 不新增审核轮; 如线程因 Main 会话变化不能恢复, 可新建线程对整个候选进行完整双轴审核并记录原因.
- 实施前核对: `manager.mjs` 的 `waitNotifications` 对 `ended` 立即返回, 通用观察没有 `completion`; `arw-background-agent-host.mjs` 的 Reviewer 观察总是附加 `completion`, 因此可凭字段存在性区分. `machine.mjs` 当前只有完成, 暂停, 取消, 退出与失败分支, 普通结束会空转. `commit/implementation-workflow.md` 在 prepare 前冻结勾选, `issue-tracking/SKILL.md` 要求先取得审核事实, 确认第二项所述冲突成立.

- 结项改动量 (新增行加删除行, 预计 / 实际): 代码 15 / 7 行, 测试 60 / 52 行, issue 与文档 75 / 77 行 (issue 62 行, 长期文档与投影 15 行); 另有就绪 JSON 13 行. 非测试代码净增 1 行, 低于 15 行预算; issue 与文档比估算多 2 行, 用于完整验证摘要和本轮结项记录. 两项发现均成立并完成, 无跳过项.
- Commit Audit 第 2 轮两个内置 Reviewer 均正常返回 ready; Code Standards 报告 No problems., 要求符合报告指出缺少预计与实际行数对照, 已在上一条补齐. 本次只修改 Comments 结项记录, 按实施提交流程第 6 步机械核对, 不新增语义复审. Main 抽查新增普通结束条件与 Reviewer 字段区分, 并回归核对 exited 的 reviewer-not-ready 分支及现有暂停与取消分支, 均保持授权合同.
