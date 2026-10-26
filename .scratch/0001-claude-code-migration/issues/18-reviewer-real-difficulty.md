# 用真实难度场景测三个 Reviewer

Status: ready-for-agent

## What to build

ticket 10 定 txt 格式所用场景过小 (候选 72 到 82 行, 每 5 到 10 行一个缺陷), 且只测了 `requirements-reviewer`. 改用真实难度的场景重新测三个角色:

- 先把 qwen_strata benchmark v2 的 Reviewer 测试整套复制过来: 冻结的 ARW 源码 (`freeze_arw_source`), v1 `benchmarks/reviewer-suite-v1/arw-patches/` 的全部补丁 (场景逐版加难, 评分 `scoring-k`, harness 补丁 `strata-measurement-time-limit`, `reviewer-private-scratch`, `codex-0.163-synthetic-mount-targets` 等), v2 的 4 个场景补丁和 `scoring-r8.5`, 按 v2 计划声明的版本依次应用 (同 `arw_dimension prepare`), 并核对物化结果 (base/candidate/handoff, 答案键, 盲裁 brief) 与 benchmark 一致.
- 已商定的改动 (ARW 现行三个角色, txt 报告格式, Code Spec 与 Commit Audit 场景交给 `requirements-reviewer`, 用户选 A) 尚未在真实难度场景上验收. 先用原样复制的 qwen_strata 那套跑出基线, 再在复制结果上应用这些改动 (评分按 txt 格式适配) 跑同样的配置; 改动后的得分不低于基线 (在测量波动内) 才算验收通过 (用户 2026-10-26).
- 验收通过前, 需要本地 Strata 审查或 Reviewer 测量时都用 qwen_strata 原样的那套.
- 再从本仓库历史中取被独立审查抓到问题的真实提交 (如 `530cca6` 修复前) 做场景.
- 每个角色用 luna xhigh 和 haiku high 各跑 2 到 3 次, 记录召回, 误报, 偷懒迹象.
- Spec Readiness 另测 haiku xhigh, 在同一冒烟场景与 haiku high 比较收敛轮数 (15 冒烟中 haiku high 5 到 9 轮才收敛). 日常 Reviewer 不考虑 sonnet, 成本过高.
- 落实 spec 中 "Gate 2 漏报记一行" 的规定.
- 本地 Strata 审查改为正规模式: 用户级配置把 Strata 设为 Reviewer 模型, 经 `arw background-agent` 的 Codex 后端启动, 与 benchmark v2 一致 (关闭搜索, 角色作为系统指令, 管理进程的压缩, 重复命令和时长处理). 审查范围按目录拆成几批, 可并行的模型并行跑.
- 用 benchmark v2 场景计一个 issue 的完整流程墙钟: 60 分钟以内为合格, 30 分钟以内为优, 达到优即停止流程优化 (用户 2026-10-26).
- 格式或模型需要调整时, 在本 ticket 中写明并修改.

## Spec Requirement

Governing requirements:

- `.scratch/0001-claude-code-migration/spec.md#review-workflow`

## Acceptance criteria

- [ ] 三个角色在真实难度场景上的召回和误报已测出, 记入 `## Comments`.
- [ ] 格式和默认模型的结论有数据支持, 必要的调整已完成.

## Blocked by

- issue:0001:15

## Comments

### 2026-10-27 第一批测量 (worker, 未提交)

范围: 原样复制 benchmark v2 Reviewer 测试, 基线, 改动后条件, Spec Readiness haiku xhigh 对比. 本仓库历史场景, Strata 正规模式, 完整流程墙钟, "Gate 2 漏报记一行" 未做.

方法:

- 复制: 冻结 ARW 源码加 v1 补丁和 v2 场景补丁, 按 v2 计划版本应用. 4 个计划的物化结果 (base/candidate/handoff, 答案键, 盲裁 brief) 与 qwen_strata 逐字节一致. 工具和物化结果在 worktree 的 `.tmp/claude-code/<session>/0001_18/` (未跟踪, 约 4MB).
- 改动后条件: 场景不变, 改用 ARW 现行三个角色和 txt 格式, Code Spec 与 Commit Audit 交给 `requirements-reviewer`.
- 运行: 每个配置 2 次, 经源码 `node arw.mjs background-agent` 启动. haiku high (Claude 后端), luna xhigh (Codex 后端).
- 评分: 冻结评分器靠英文 referenceTerms 关联, 现行角色写中文报告, 改动后条件在冻结评分器下检出为 0, 无法公平比较. 两个条件统一改用自写的格式无关匹配器 (按答案键的定位行与关键词把每条发现分给最匹配的案例, 命中 clean 案例或无匹配记误报), 再由 worker 人工复核误报. 不是盲裁. 基线另用冻结评分器打分, 作参考.
- 偷懒迹象: 记为 incomplete 或明显过短的运行.

结果 (召回为 2 次检出之和/问题总数之和, 误报为 2 次之和, 耗时为每次平均分钟):

| 场景 | 模型 | 基线召回 | 基线误报 | 基线耗时 | 改动召回 | 改动误报 | 改动耗时 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Code Spec | haiku | 31/40 | 0 | 5.8 | 35/40 | 0 | 4.6 |
| Code Spec | luna | 31/40 | 1 | 10.4 | 33/40 | 1 | 8.9 |
| Code Standards | haiku | 38/52 | 2 | 5.3 | 41/52 | 3 | 3.5 |
| Code Standards | luna | 38/52 | 0 | 7.1 | 39/52 | 1 | 6.3 |
| Commit Audit | haiku | 80/80 | 0 | 7.1 | 78/80 | 2 | 5.8 |
| Commit Audit | luna | 2 次均 incomplete | - | - | 79/80 | 1 | 8.9 |
| Spec Readiness | haiku | 37/46 | 4 | 9.3 | 30/46 | 8 | 10.8 |
| Spec Readiness | luna | 33/46 | 3 | 16.3 | 33/46 | 13 | 23.8 |

单次波动: haiku SR 基线 18 与 19, 改动 16 与 14; luna SR 基线 20 与 13, 改动 15 与 18. Spec Readiness 耗时含 runtime 与 artifact 两个子场景.

冻结评分器 (基线 rep1, haiku): Code Spec 0.572, Code Standards 0.699, Commit Audit 0.889, SR runtime 0.979, SR artifact 0.540. luna: Code Spec 0.641, Code Standards 0.662.

结论:

- Code Spec, Code Standards, Commit Audit: 改动后不低于基线, 耗时更短, 验收通过. Commit Audit 两边都接近满分, 区分度低.
- Spec Readiness: 未通过. haiku 召回 37 降到 30, 误报 4 升到 8; luna 召回持平, 误报 3 升到 13. 复核误报: 主要是现行角色把 "不改变调用方行为的算法要求" 和 `#adr-evaluation` 章节判为不应进入长期规范, 另有同一问题重复报告. 这是现行 SR 规则与 v2 答案键的口径差异加重复, 不是格式错误. 需要决定是改现行 SR 角色, 还是认定答案键过时.
- luna 基线 Commit Audit 失败是原样套件本身的问题: 一次称 `docs/agents/commit-audit-reviewer/gate-2.md` 不存在 (实际在 `docs/agents/roles/commit-audit-reviewer/gate-2.md`, 旧角色文本的相对链接作为指令下发后失效), 一次称 `reviewer.md` 要求读 `commits.md` 而 handoff 禁止读. haiku 自行解决了路径. 改动后条件无此问题.
- 偷懒迹象: 除上述外, 只有 haiku 基线 rep2 三个运行因 Claude 后端在 dontAsk 模式下拒绝 Read/Bash 而在 1 分钟内 incomplete. 这是后端权限的偶发问题, 不是模型偷懒, 已换新实例重跑并计为 rep2.

Spec Readiness 收敛轮数 (15 冒烟 `claude-pre-readiness` 场景, 各 1 次, worker 自己按发现修 spec):

| 配置 | 轮数 | 各轮缺口数 | 总耗时 |
| --- | --- | --- | --- |
| haiku high | 3 | 10, 2, 0 | 7.3 分钟 |
| haiku xhigh | 5 | 2, 7, 1, 1, 0 | 17.6 分钟 |

xhigh 没有更快收敛, 第 2 轮重新提出整篇层面的问题, 耗时为 high 的 2.4 倍. 只有 1 个样本, 且两边的修法随发现不同, 结论只作参考; 维持 haiku high.

偏离: 未用盲裁, 改用规则匹配加人工复核; 修 spec 时没有按规则与独立 subagent 共同决定; luna SR 基线 rep1 的 artifact 子场景因供应商容量拒绝重发一次, 耗时偏长.
