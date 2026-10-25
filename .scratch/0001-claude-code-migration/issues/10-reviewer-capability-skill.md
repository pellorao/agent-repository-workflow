# Reviewer 能力一致性与 benchmark 改为不自动触发的 Skill

Status: in-progress

## What to build

Reviewer 能力一致性和 reviewer-benchmark 改为源码仓库专用, 不自动触发的 Skill, 仍由 Agent 执行, 目标是证明 Reviewer 角色能发现已知问题, 两种后端都可用. 实现压缩到达成目标所需的最小程度. 用它比较 08 的轻格式下 luna xhigh 和 haiku high 的检出率, 检出率下降的模型恢复必要的复述要求. 比较的格式档位至少包括 08 的轻格式和最轻一档 (只用自然语言把问题逐条写进 txt).

预估改动: 大幅净减.

## Spec Requirement

Governing requirements:

- `.scratch/0001-claude-code-migration/spec.md#rule-structure-and-context-budget`
- `.scratch/0001-claude-code-migration/spec.md#code-reduction`

08 遗留给本 ticket: 为 `requirements-reviewer` 补能力场景, 删除只给退役角色用的评分代码; 发布 spec 中能力测试一节仍按 Code Spec 和 Commit Audit 描述, 一并改写; 评估复审时 Reviewer 手工抄写前轮结论导致旧行号偏移的问题.

## Acceptance criteria

- [x] Skill 不自动触发, 两个平台的元数据都已设置.
- [x] 按 Skill 执行能在两种后端各完成一次检查.
- [x] 轻格式下两个默认模型的检出率已测出, 结论和格式调整记入 `## Comments`.
- [x] 相关代码, 测试和文档大幅净减, 测试通过.

## Blocked by

- 03 共享工具函数与声明式校验
- 04 Claude 后端跑通 Reviewer
- 07 流程文档改为自动触发的 Skill
- 08 合并审核流程

## Comments

- Reviewer Capability Conformance 和 reviewer-benchmark 合并为源码专用 Skill `.agents/skills/reviewer-capability/`. Claude 侧设置 `disable-model-invocation: true`, Codex 侧设置 `allow_implicit_invocation: false`, 该 Skill 不进入 Workflow Distribution. 保留的只有:
  - 场景目录: `base/`, `candidate/`, 可选的 `handoff.md`, 隐藏的 `expected.md`.
  - 搭建脚本 `scripts/reviewer-capability.mjs`: 搭好场景仓库, 按角色准备审核输入, 输出可直接交给 `arw background-agent` 的 `spawn_agent` input.
  - 匹配裁决由 Main Agent 完成.
- 删除的内容:
  - 准备, 评分, 折减, 会话检查, 统计与 benchmark 程序.
  - 6 份 docs/agents 文档, `release-candidate.mjs`, `release-step-review-material.mjs`.
  - spec-readiness 的 capability 解析分支, 以及只给 benchmark 用的速度计算.
- 发布规格中的能力门禁改为 "按需能力测试" 一节; ADR 0016 标注该部分已被取代.
- 新增两个 `requirements-reviewer` 场景:
  - `rate-limiter`: 6 个预设缺陷.
  - `todo-archive`: 6 个预设缺陷. 测量中两种模型还发现 2 个真实缺陷, 已补进 `expected.md`: 日历上不存在的日期被接受; 缺 `--before` 时把第一个参数当作日期. 另有一项 "无效日期测试没有先创建 `archive.json`" 有歧义 (测试断言了它不存在), 记为不计分.
- 旧的 JSON 预期已转为 `expected.md`.
- 格式测量:
  - 范围: `requirements-reviewer`, 上述两个场景, 每格先跑 1 次; todo-archive 结果有差异, 4 格各再跑 1 次, 共 12 次.
  - 召回 = 命中数 / 全部 Problem 数. rate-limiter 有 6 个, todo-archive 有 8 个, todo-archive 取两次平均.
  - 两种格式的 12 次运行都命中了全部 12 个预设缺陷, 都没有把 Clean 项误报为问题; 差别只出在看过结果后补进的 2 个缺陷上.

| 模型 | 格式 | rate-limiter | todo-archive (两次) | 召回 | 偷懒或格式迹象 |
| --- | --- | --- | --- | --- | --- |
| gpt-6-luna xhigh | 08 清单 | 6/6 | 7/8, 7/8 | 93% | 一次复制模板后在空 `verdict:` 下追加新行, `generateCommitAudit` 仍接受 |
| gpt-6-luna xhigh | txt | 6/6 | 7/8, 7/8 | 93% | 无 |
| haiku high | 08 清单 | 6/6 | 6/8, 6/8 | 86% | 没有 Bash, 读不到已暂存字节, 仍返回 ready |
| haiku high | txt | 6/6 | 8/8, 6/8 | 93% | todo-archive 两次如实返回 incomplete (读不到已暂存字节); 有一条超出场景的推断 (仓库里没有把返回值转成退出码的入口) |

- 格式决定: 采用最轻一档 txt, 即用自然语言逐条写问题, 没有问题时写 `No problems.`.
  - 依据: 两个模型在 txt 下都未观察到召回下降, 都不需要恢复复述要求.
  - 局限: 只能说明 "未观察到下降", 不能证明两种格式等效. 只测了 `requirements-reviewer`; 场景偏易, 预设缺陷有天花板效应; 每格只有 1 到 2 次; 差别全部来自看过结果后补进的缺陷, 有选择偏差; haiku 两格的交付状态不同 (清单返回 ready, txt 在 todo-archive 返回 incomplete), 有混杂因素.
  - 后续: 按 spec, 采用这一档后提交门禁改为 "Reviewer 正常结束且问题都已处理", 并删除 commit-audit 的逐条要求记录, 包括 prepare 生成的清单, generate 生成的记录, verify 的定位校验, commit Skill 的 Gate 1/Gate 2 记录和角色输出.
  - 本 ticket 未实施: 改动跨 commit-audit, commit Skill, 角色和规格, 不算小改动, 需要另行分派.
- 两种后端各完成一次检查: 测量用的是 runner 输出再经 scratch 脚本改写格式 (清单一档的改写与现在 runner 的处理相同), 共 12 次. code-standards 和 spec-readiness 场景只验证了 runner 能生成 input, 本 ticket 没有实跑.
- 08 遗留的复审旧行号偏移: 只有程序校验 `evidence` 定位时才会出错, 因为清单 verify 用当前候选核对行号. 采用 txt 后不再有程序校验的定位, Reviewer 每轮重写完整问题列表, 这个问题随之消失, 不另做修补.
- 测量中发现的产品缺陷, 本 ticket 未修复:
  - commit-audit `prepare` 把清单预先写进 `reports/review.md`, 而 Reviewer 运行时要求新审核的绑定报告为空 (`A new review requires its own existing empty bound report file`). 结果是 08 之后的实施提交无法启动 `requirements-reviewer`.
    - 临时处理: 测量和 `scripts/reviewer-capability.mjs` 先把清单移到报告目录外, 让 Reviewer 复制后再填写.
    - 改用 txt 后该缺陷随之消失.
  - Claude 后端的 Reviewer 只有 `Read,Grep,Glob,Edit,Write` 工具 (`lib/background-agent/claude-sessions.mjs:78`), 没有 Bash, 所以不能运行交接要求的 `git diff --cached` 和 `git show :<path>`.
    - 本次场景中暂存字节与工作区相同, 测量结果仍然有效.
    - 真实仓库中工作区与索引不同时, Reviewer 会审错版本.
  - Reviewer 返回 `incomplete` 后, 运行时不停地续派 "complete successful delivery ... has not been confirmed". haiku 每轮都重复 incomplete, 8 分钟内续了约 30 轮, 最后只能停掉守护进程.
- 从源码入口运行测量需要程序目录下的 `config.json` 和 `~/.codex/models.custom.json`. 旧安装没有后者时, 两个后端都会报 `Cannot read models.custom.json`.
