# 用真实难度场景测三个 Reviewer

Status: ready-for-agent

## What to build

ticket 10 定 txt 格式所用场景过小 (候选 72 到 82 行, 每 5 到 10 行一个缺陷), 且只测了 `requirements-reviewer`. 改用真实难度的场景重新测三个角色:

- 搬入 qwen_strata `benchmarks/multi-model-v2` 的 4 个场景 (物化补丁后的 base/candidate/handoff), 答案键和盲裁 brief 一并搬入作为裁决依据. 用 ARW 当前三个角色和 txt 格式 (用户 2026-10-26 选 A): Code Spec 与 Commit Audit 场景都交给 `requirements-reviewer`.
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
