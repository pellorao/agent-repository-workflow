---
name: reviewer-capability
description: 仅在维护者显式调用时, 在 ARW 源码仓库中测试 Reviewer 角色能否在 Codex 和 Claude 后端发现已知缺陷, 或比较模型的发现率.
disable-model-invocation: true
---

# Reviewer Capability

只在 ARW 源码仓库中由维护者显式调用. 结果不提供审核, 实施, 发布或提交授权.

## Scenarios

场景在 `tests/fixtures/reviewer-capability/<role>/<scenario>/`, 目录名 `<role>` 就是受测角色:

- `base/` 和 `candidate/`: 场景仓库的基线提交与已暂存候选; 同角色的 `common/base`, `common/candidate` 先叠加.
- `handoff.md` (可选): 追加到交接的场景说明.
- `expected.md`: 隐藏预期, 只给 Main Agent 裁决用, 不进入场景仓库. `## Problems` 是应发现的缺陷, `## Clean` 是报告即误报的正确行为.

新增场景时, 每个缺陷都要在候选中有确定位置; 测量中发现的真实未预设缺陷补进 `## Problems` 并在 issue 中说明.

## Run

1. 确认本次的角色, 场景, 后端和设置 (`model`, `modelProvider`, `reasoningEffort`, `serviceTier`). 每格先跑一次, 只对结果接近的格增加重复.
2. 在当前会话临时目录 `.tmp/<platform>/<session>/<run>/` 下为每个实例搭建场景仓库:

   ```sh
   node scripts/reviewer-capability.mjs <scenario-directory> .tmp/<platform>/<session>/<run>/<instance>
   ```

   它输出一行 `spawn_agent` input (角色指令, 交接, 空报告, 恢复目录). 实例目录必须是新路径. 比较别的报告格式时, 改写场景仓库中的角色文件和 input 的 `instructions`, `handoff`, `reportPath`, `writePaths`.
3. 按 `reviewer-launch` Skill 通过 `arw background-agent` 启动: 给 input 加上 `settings`, 例如 Codex `{"model":"gpt-6-luna","modelProvider":"openai","reasoningEffort":"xhigh","serviceTier":"default"}`, Claude `{"model":"haiku","modelProvider":"anthropic","reasoningEffort":"high","serviceTier":"default"}`. 用 `wait_agent` 等到完成, 记录 `measurement`.
4. Main Agent 逐份阅读 `reportPath`, 对照 `expected.md` 裁决: 一条发现与某个 Problem 指同一缺陷即命中, 位置可不同; 命中 Clean 项记误报; 其他发现核对候选后判真实或误报.
5. 在活动 issue 中写结果表: 每个模型 × 场景 (× 格式) 的召回 (命中数/Problem 数), 误报和偷懒迹象 (未检查却声称满足, 批量填写, 错误定位, 格式损坏). 说明样本量和天花板效应.

Strata 提供方先读 [Strata 程序合同](../../../docs/specs/agent-repository-workflow/strata.md). 直接启动的 `claude -p` 不在本流程内.

## Finish

按 pid 停止本次启动的客户端和守护进程, 删除本次临时目录.
