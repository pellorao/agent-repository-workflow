# 减少审核轮次: 就绪审核一次报全, 未改 spec 时跳过 Gate 2

Status: ready-for-agent

## What to build

近期目标是在基本不降低质量的前提下缩短开发时间 (effort spec 问题 5, 用户 2026-10-28). ticket 18 第三批的完整流程测量 (流程 B, 约 36 分钟) 显示两个仍可削减的环节:

- 就绪审核串行暴露问题: `docs/agents/roles/spec-readiness-reviewer.md` 的检查顺序第 2 步规定 `SPEC-READINESS-REQUIREMENTS` 有 `gap` 或 `uncertain` 时提前返回, 于是 Module Design 等后续检查到第 4 轮才首次运行 (各轮问题数 10, 1, 1, 12, 3, 0). 改为每轮完成全部已注册检查后再返回, 让一轮报出全部问题. 只有后续检查确实无法在当前 Requirements 缺陷下判断的部分才留到下一轮, 并在报告中写明.
- 未改 spec 时仍跑最终 Gate 2 spec 审计: effort 内没有 spec 变化时, 允许跳过 Gate 2. `lib/commit-audit/commit-audit.mjs` 目前在 Gate 2 文档非空时拒绝 `gate2Exception` (约第 103 到 115 行), 需要引擎支持这一跳过条件, 并修改 `commit` Skill 及其投影和分发副本, 长期规范对应条款.

ticket 18 第三批 (2026-10-28) 留下的两处冲突一并解决:

- 规则与运行时冲突: `commit` Skill 的 "Other reviews" (只改规则和文档时的单个 `requirements-reviewer`) 要求空 `issueIds`, 运行时 `lib/reviewer-runtime/reviewer-session-record.mjs` (约第 87 行) 要求非空 `issueIds` 或 isolated 身份而拒绝请求. 改其中一方使两者一致, 取改动最小的一方.
- 长期规范 `docs/specs/agent-repository-workflow/spec.md` 约第 164 行的 Interface 说明同步 "包含已有字段含义的改变" (就绪审核角色与 `spec-readiness` Skill 已改).

另在只实施部分 spec 的场景上重测一次完整流程墙钟, 衡量 ticket 18 写入的来源分流规则 (既有问题记 issue, 不阻断) 实际省下的时间; 第三批的场景实施整份 spec, 分流几乎没有作用.

质量约束: 就绪审核角色改动后, 用 benchmark v2 的 spec-readiness v4.5 场景重跑盲裁 (Reviewer haiku high ×2, 裁判至少 sonnet high), 检出和误报不得劣于 ticket 18 第三批 (37/46, clean 误报 10) 超出测量波动.

开工条件: ticket 18 第三批 (就绪审核角色与来源分流规则) 已合入 main; 不必等 ticket 18 其余部分.

预估净增: 角色和 Skill 约 +10, 引擎与测试约 +30, 合计约 +40.

## Spec Requirement

Governing requirements:

- `.scratch/0001-claude-code-migration/spec.md#review-workflow`
- `docs/specs/agent-repository-workflow/spec.md#commit-audit`

## Acceptance criteria

- [ ] 就绪审核角色不再在 Requirements 缺陷后提前返回; 盲裁结果不劣于 ticket 18 第三批 (在波动内), 记入 `## Comments`.
- [ ] effort 内没有 spec 变化时可以跳过 Gate 2, 引擎和测试覆盖, `commit` Skill 与长期规范已更新.
- [ ] 部分实施场景的完整流程墙钟已测, 与 ticket 18 第三批对比记入 `## Comments`.
- [ ] 只改规则和文档时的单个 `requirements-reviewer` 能按 `commit` Skill 启动; 长期规范的 Interface 说明已同步.
- [ ] 全量测试, 投影与分发检查, `arw text check` 通过.

## Blocked by

- None - can start immediately
