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
3. 按 `reviewer-launch` Skill 通过 `arw background-agent` 启动: 给 `input` 加上 `settings`, 例如 Codex `{"model":"gpt-6-luna","modelProvider":"openai","reasoningEffort":"xhigh","serviceTier":"default"}`, Claude `{"model":"haiku","modelProvider":"anthropic","reasoningEffort":"high","serviceTier":"default"}`. 用 `wait_agent` 等到完成, 记录 `measurement`. 本流程覆盖 `reviewer-launch` 对阈值暂停通知的处理 (不询问用户): `wait_agent` 返回来源 `provider-program` 且正文以 `The Reviewer runtime paused this same task after ` 开头的通知时, Main 对同一运行发 `send_message` "继续" 后再 `wait_agent`, 直到 `completion` 非空. 完成后, `unload_agent` 之前, 把该运行的 `list_agents {runId}` 结果存为 `<instance>/agent.json` (已送达消息卸载后或超过 24 小时即丢失), 供计分统计暂停.
4. 计分: 报告是当前角色的自由格式 (`.txt` 或 `.md`, 要点 `- ... path:line`), 基线格式用 `.jsonl`:

   ```sh
   node scripts/reviewer-capability.mjs repair <scenario-directory> <reportPath> <repaired-path> [--spill <溢出文件> ...]
   node scripts/reviewer-capability.mjs score <scenario-directory> <reportPath 或 repaired-path> (--repair <repaired-path>.changes.json | --no-repair) --agent <instance>/agent.json --instance <唯一实例名> [--decisions <root>/<name>/decisions.json ...]
   ```

   先对每份报告做 `repair` (规范化副本与修复记录); 记录有修改时对副本计分并给 `--repair`, 无修改时对原报告计分并给 `--no-repair`; 二者必须声明其一, 缺少 `--agent` 也返回 `blocked`.

   输出 `{status, candidates, scores}`. `candidates` 是尚未裁决的候选 (关联候选与发现候选), `scores` 是按现有裁决计的分 (未裁决的候选按机械规则暂计), 含 `reportDiagnostics`, `scoreBeforePenalty` 与残差折减后的 `score`. 空报告或没有可评分内容的报告是模型失败, 返回 `succeeded` 且分数为 0 (带 `modelFailure`). `--instance` 在不同报告间必须唯一, 因为候选的稳定 id 含它. `scores` 另含格式罚, 暂停扣分与 `final`. Commit Audit 的 txt 报告没有 satisfied 行, 只计问题召回. Spec Readiness 的两个子场景各自计分后 (它们的单份输出没有 `final`), 把两份 `score` 输出存成文件再合成一次重复的分数: `node scripts/reviewer-capability.mjs combine <score-1.json> <score-2.json>`; 单个子场景的分数不能与整次重复比较. `baseline <unit>` (评分单元 `code-standards`, `code-spec`, `commit-audit`, `spec-readiness`) 校验该评分单元登记的 pBase 基线及其归档; 场景答案键改动后须重测基线并重新登记.
5. 盲裁: 把 `candidates` 数组存成 JSON 文件, 同一裁决批次的所有报告 (Spec Readiness 含两个子场景) 并入同一次建池:

   ```sh
   node scripts/reviewer-capability.mjs pool build <scenario-directory> <root> <name> <candidates.json ...> [--decisions <已有裁决库> ...]
   node scripts/reviewer-capability.mjs pool view <root> <name> <scenario-directory ...>
   node scripts/reviewer-capability.mjs pool prompt <root> <name>
   ```

   候选超过池上限 (150, Spec Readiness 与 Code Standards 为 210) 时自动拆成 `<name>-1`, `<name>-2` ... 多个池, 其余步骤对每个池各做一次; `--decisions` 让已有同简报裁决的候选不再入池. `pool view` 从夹具现场搭出被审状态写入 `<root>/<name>/adj/` (Spec Readiness 给两个子场景目录, 其余角色给一个), 不必从 Reviewer 工作过的实例目录取; 它还写 `change.diff`, 脱敏的 `REVIEWER-REQUEST.json` 与 `view-binding.json`, `pool prompt` 据此检查 `adj/` 未被改动. `adj/` 是裁判唯一可见的目录, key, 提示和裁决库在 `<root>/<name>/`, 不在 `adj/` 内.
6. 用 `pool prompt` 输出的 `prompt.md` 启动一个裁判 (至少 sonnet high, 不用 haiku; 唯一例外: issue 18 迁移验收与已有 haiku 基线的对比), 让它读写 `adj/` (提示中 `<ADJ>` 就是 `adj`, 把 `adj/` 复制进裁判的工作目录). 裁判写出 `adj/decisions-<name>.json` 后:

   ```sh
   node scripts/reviewer-capability.mjs pool split <root> <name> <root>/<name>/adj/decisions-<name>.json [--hard <池项 id> ...]
   ```

   锚点一致率不低于 0.9 且合成对照全对才通过, 通过后裁决写入 `<root>/<name>/decisions.json`; 不通过返回 `blocked` 且不写任何裁决, 整池重裁. 输出含分族与分模型的一致率, 并在 `<root>/<name>/split-<name>.json` 给出 Main 复核清单 (全部 `supported`, 以及有争议的 `unsupported`: 裁判点名最难 (`--hard`), 理由含犹豫措辞, 或证据与别的候选相交). Main Agent 复核清单, 需要改的用 `pool override <root> <name> <stable-id> <decision> <reason> [--by <谁>]` (保留历史). 复核确认为稳定的关联裁决可登记为新锚点: `pool anchor-add <scenario-directory> <candidate.json> <matched|not-matched> --family <openai|anthropic|strata> --model <来源模型> --confirmed-by <谁> [--id <id>]`, 这是唯一写夹具的命令, 随后经 Git 提交.
7. 带上裁决库重新 `score ... --decisions <root>/<name>/decisions.json`. 简报改动后旧裁决不再套用, 输出的 `staleDecisions` 列出它们, 须重裁. 关联候选被裁为 `not-matched` 后, 对应 finding 成为新的发现候选, `candidates` 非空时对它们再做步骤 5 和 6 (新池名), 并把新旧裁决库都传给 `--decisions`, 重复到 `candidates` 为空, 此时分数为定稿. 想先看分数区间可加 `--provisional lower|upper` (未裁决候选按最低或最高界值暂计, 结果不是定稿), `--enumerate` 只列出候选全集 (不要求 `--agent`, 无分数). 输出的 `templateFindings` 标出同一实例内文字雷同的 finding, 只作提示, 不改分数.
8. 统计: 每格 (一个模型 × 场景 × 设置) 的重复实例按开始先后给出定稿的 `score` (Spec Readiness 用 `combine`) 输出:

   ```sh
   node scripts/reviewer-capability.mjs summary [--markdown] --cell <标签> <score.json ...> [--cell <标签> <score.json ...>]
   ```

   每格前 5 个实例入主统计 (平均, SD, SE, 95% 区间, 负分数个数, 最小, 中位数), 其余列入 `extraIds` 并提示; 未定稿的输入返回 `blocked`.
9. 在活动 issue 中写结果表: 每个模型 × 场景 (× 格式) 的 `score`, 召回, 误报和偷懒迹象 (未检查却声称满足, 批量填写, 错误定位, 格式损坏). 说明样本量和天花板效应.

Strata 提供方先读 [Strata 程序合同](../../../docs/specs/agent-repository-workflow/strata.md). 直接启动的 `claude -p` 不在本流程内.

## Finish

按 pid 停止本次启动的客户端和守护进程, 删除本次临时目录. 裁决库是套件唯一的持久可变状态, 需要保留时随结果一起归档.
