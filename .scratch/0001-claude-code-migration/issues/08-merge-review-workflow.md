# 合并审核流程

Status: completed

## What to build

Code Spec 与 Commit Audit Gate 1 合并为要求符合审核, Code Standards 增加指出可删除代码的职责并重申最高原则, 两者并行. 复审只看改动部分及其影响范围. Spec Readiness 只在 spec 定稿时审核, `verify` 只在提交前运行. Gate 2 时机不变, spec 末尾记录 Haiku Gate 2 漏报. 规则和引擎代码一起修改. 按 spec 简化 Reviewer 输出格式: 先采用轻格式 (程序生成要求清单, Reviewer 只填结论和证据定位, 程序检查每项有结论且定位存在, Main Agent 抽查 `satisfied` 项); 最终放多低由 10 的能力测试决定.

预估改动: 约 ±400 行.

## Spec Requirement

Governing requirements:

- `.scratch/0001-claude-code-migration/spec.md#review-workflow`

## Acceptance criteria

- [x] 一次提交最多两个并行 Reviewer.
- [x] Reviewer 不再编写严格 JSON; 漏填或定位无效的清单项使结果判为不完整.
- [x] 复审只交付改动部分, 未受影响的结论保留.
- [x] 相关测试通过, 被删流程的代码和测试已删除.

## Blocked by

- 04 Claude 后端跑通 Reviewer
- 07 流程文档改为自动触发的 Skill

## Comments

- 新角色 `requirements-reviewer` 取代 `code-spec-reviewer` 和 `commit-audit-reviewer`; 提交时与 `code-standards-reviewer` 并行, 一次提交最多这两个. 用户配置中的退役角色键被忽略 (原先给它们设的模型不再生效).
- `lib/commit-audit/commit-audit.mjs` 重写 (1555 -> 约 420 行): `prepare` 生成 `reports/review.md` 清单 (issue `## What to build` 正文行和每条验收标准; Gate 2 时治理文档全部正文行); Reviewer 填 `verdict`, 一个 `path:line` 定位和必要 `note`; `generate` 检查每项, 缺失或无效返回 `review-incomplete`; `verify` 检查正式记录覆盖每个要求行. 在 spec 之外增加了 `n/a` 结论 (须写说明, 验收标准不可用), 用于背景或估算等不含要求的正文行.
- Code Standards 增加可删除代码检查和最高原则复述; 复审规则改为只交付变化及影响范围; Spec Readiness 改为定稿时审核一次, `verify` 只在提交前运行; commit Skill 写入每轮抽查一到两项 `satisfied` 以及 Gate 2 漏报记录.
- 能力一致性和 benchmark 中两个退役角色的支持连同测试, 夹具一起删除 (含 `needs-requirement-binding` 机制). `requirements-reviewer` 的能力场景留给 10. ADR 0023 是历史记录, 未修改, 其中指向已删标题的锚点已失效.
- 行数: lib 51335 -> 49376; 规则 (`docs/agents`, `.agents/skills`, `AGENTS.md.bak`) 6060 -> 5924; tests 54751 -> 45972. 超出 ±400 的部分都是删除.
- 测试: 1037 项, 1033 通过, 1 失败 (改前已存在的 `AGENTS.md` 改名所致), 3 跳过; `pnpm typecheck`, `tests/rule-budget.test.mjs` 和 `node scripts/check-workflow-distribution.mjs` 通过.
- 独立审查发现并已修正: 验收标准可被标为 `n/a` 绕过; 定位行数对 LF 结尾文件多算一行; `verify` 不检查 Gate 2 文档范围, 例外与治理文档冲突, 多余来源和 Gate 1 的 `not-applicable`; commit Skill 失败条件与非阻断 `gap` 矛盾; 非提交 Requirements 线程身份与提交审核冲突; 发布 spec 仍写串行 Commit Audit. 未采纳: 复审时前轮结论需由 Reviewer 抄入新清单, 程序无法发现抄来的旧行号偏移, 留给 10 按能力测试评估.
