---
name: reviewer-capability
description: 仅在维护者显式调用时, 在 ARW 源码仓库中测试 Reviewer 角色能否在 Codex 和 Claude 后端发现已知缺陷, 或比较模型的发现率.
disable-model-invocation: true
---

# Reviewer Capability

只在 ARW 源码仓库中由维护者显式调用. 结果不提供审核, 实施, 发布或提交授权. 套件来自 qwen_strata benchmark v2, 完全由 `scripts/reviewer-capability.mjs` 和 `lib/reviewer-capability/` 实现 (Node, 无第三方依赖); 其合同在[开发规格](../../../docs/specs/agent-repository-workflow-development/spec.md#module-design).

## Scenarios

场景在 `tests/fixtures/reviewer-capability/<role>/<scenario>/`, 目录名 `<role>` 就是受测角色. 夹具是只读输入, 保存的是物化后的最终结果:

- `base/` 和 `candidate/`: 场景仓库的基线提交与已暂存候选; 同角色的 `common/base`, `common/candidate` 先叠加 (Spec Readiness 的 `runtime-migration` 只用 `common`).
- `handoff.md` (可选): 追加到交接的场景说明.
- `expected.json`: 隐藏答案键 (问题用例与干净用例, 每例带 k 档位和证据位置), 只给评分用, 不进入场景仓库.
- `brief.md` 和 `anchors.json`: 盲裁 brief 与已知裁决的锚点和合成对照; Spec Readiness 两个子场景共用 `common/` 中的一份.

场景: `requirements-reviewer/code-spec`, `requirements-reviewer/commit-audit`, `code-standards-reviewer/code-standards`, `spec-readiness-reviewer/runtime-migration`, `spec-readiness-reviewer/artifact-promotion`. 新增缺陷要同时补答案键和候选中的确定位置; 测量中发现的真实未预设缺陷补进答案键并在 issue 中说明.

## Run

1. 确认本次的角色, 场景, 后端和设置 (`model`, `modelProvider`, `reasoningEffort`, `serviceTier`). 每格先跑一次, 只对结果接近的格增加重复.
2. 在当前会话临时目录 `.tmp/<platform>/<session>/<run>/` 下为每个实例搭建场景仓库 (实例目录必须是新路径; 返回的 `stateDirectory` 是它的同级 `state`, 恢复记录必须在会话临时目录内, 所以实例不能放在别处):

   ```sh
   node scripts/reviewer-capability.mjs setup <scenario-directory> .tmp/<platform>/<session>/<run>/<instance>
   ```

   输出 `{"status":"succeeded","input":{...}}`, `input` 是 `spawn_agent` 输入 (角色指令, 交接, 空报告, 恢复目录). 比较别的报告格式时, 改写场景仓库中的角色文件和 `input` 的 `instructions`, `handoff`, `reportPath`, `writePaths`.
3. 按 `reviewer-launch` Skill 通过 `arw background-agent` 启动: 给 `input` 加上 `settings`, 例如 Codex `{"model":"gpt-6-luna","modelProvider":"openai","reasoningEffort":"xhigh","serviceTier":"default"}`, Claude `{"model":"haiku","modelProvider":"anthropic","reasoningEffort":"high","serviceTier":"default"}`. 用 `wait_agent` 等到完成, 记录 `measurement`.
4. 计分: 报告是当前角色的自由格式 (`.txt` 或 `.md`, 要点 `- ... path:line`), 基线格式用 `.jsonl`:

   ```sh
   node scripts/reviewer-capability.mjs score <scenario-directory> <reportPath> --instance <唯一实例名> [--decisions <root>/<name>/decisions.json ...]
   ```

   输出 `{status, candidates, scores}`. `candidates` 是尚未裁决的候选 (关联候选与发现候选), `scores` 是按现有裁决计的分 (未裁决的候选按机械规则暂计). `--instance` 在不同报告间必须唯一, 因为候选的稳定 id 含它. 不计 pause, format penalty, registry sha 绑定和 0.9 残差截断. Commit Audit 的 txt 报告没有 satisfied 行, 只计问题召回.
5. 盲裁: 把 `candidates` 数组存成 JSON 文件, 同一裁决批次的所有报告 (Spec Readiness 含两个子场景) 并入一个池:

   ```sh
   node scripts/reviewer-capability.mjs pool build <scenario-directory> <root> <name> <candidates.json ...>
   node scripts/reviewer-capability.mjs pool prompt <root> <name>
   ```

   `<root>/<name>/adj/` 是裁判唯一可见的目录, 含 `pool-<name>.json`; 按 brief 第二条把被审状态放进 `adj/`: code-spec 与 code-standards 的 `view/` (场景实例已暂存文件, 用 `git -C <instance> checkout-index -a --prefix=<adj>/view/`) 和 `change.diff` (`git -C <instance> diff --cached --no-ext-diff HEAD`), commit-audit 的 `view/`, Spec Readiness 的 `view-rm/` 与 `view-ap/` (同样的暂存文件, 加该实例的 Reviewer Request 复制为 `REVIEWER-REQUEST.json`). key, 提示和裁决库在 `<root>/<name>/`, 不在 `adj/` 内. 候选超过 150 (Spec Readiness 与 Code Standards 为 210) 时命令返回 `blocked`, 拆成几批各自建池.
6. 用 `pool prompt` 输出的 `prompt.md` 启动一个裁判 (至少 sonnet high, 不用 haiku; 唯一例外: issue 18 迁移验收与已有 haiku 基线的对比), 让它读写 `adj/` (提示中 `<ADJ>` 就是 `adj`, 把 `adj/` 复制进裁判的工作目录). 裁判写出 `adj/decisions-<name>.json` 后:

   ```sh
   node scripts/reviewer-capability.mjs pool split <root> <name> <root>/<name>/adj/decisions-<name>.json
   ```

   锚点一致率不低于 0.9 且合成对照全对才通过, 通过后裁决写入 `<root>/<name>/decisions.json`; 不通过返回 `blocked` 且不写任何裁决, 整池重裁. Main Agent 复核 `supported` 与有争议的 `unsupported`, 需要改的用 `pool override <root> <name> <stable-id> <decision> <reason>` (保留历史).
7. 带上裁决库重新 `score ... --decisions <root>/<name>/decisions.json`. 关联候选被裁为 `not-matched` 后, 对应 finding 成为新的发现候选, `candidates` 非空时对它们再做步骤 5 和 6 (新池名), 并把新旧裁决库都传给 `--decisions`, 重复到 `candidates` 为空, 此时分数为定稿.
8. 在活动 issue 中写结果表: 每个模型 × 场景 (× 格式) 的 `score`, 召回, 误报和偷懒迹象 (未检查却声称满足, 批量填写, 错误定位, 格式损坏). 说明样本量和天花板效应.

Strata 提供方先读 [Strata 程序合同](../../../docs/specs/agent-repository-workflow/strata.md). 直接启动的 `claude -p` 不在本流程内.

## Finish

按 pid 停止本次启动的客户端和守护进程, 删除本次临时目录. 裁决库是套件唯一的持久可变状态, 需要保留时随结果一起归档.
