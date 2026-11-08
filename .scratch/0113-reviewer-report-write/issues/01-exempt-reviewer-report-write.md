# 明确 Reviewer 写报告不受 agent-writes 读取要求约束

Status: completed

## What to build

根 `AGENTS.md` 的 Agent Writes 要求写入任何文件前读取 `docs/agents/agent-writes.md`, 而 Reviewer 角色规则只许读取本轮给定输入, 同时允许写入本轮报告. 两者冲突曾使 Code Standards Reviewer 返回 `incomplete` (codex20 11-09, Issue K). 在 Agent Writes 的该句后追加一句: 独立 Reviewer 只写 Main Agent 指定的报告路径, 该写入由 Reviewer 角色规则授权, 不受此读取要求约束. 同步修改 `AGENTS.md` 与 `distribution/baseline/AGENTS.md` 的 managed 区域, 不改其他文件.

预估净增: 文档约 60 个字符 x 2 个文件. 不涉及代码, 规范或设计决定; 只改 Agent 规则, 不安排就绪审核. 改动确认: Main Agent 已按最小改法确认 (`docs/ARW.md` 本机例外).

## Acceptance criteria

- [x] 两处 Agent Writes 的措辞一致并写明例外.
- [x] 分发检查, 文本检查通过.

## Blocked by

- None - can start immediately

## Validation

- `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `node arw.mjs text check`, `git diff --check` 通过; `pnpm test` 949 项全部通过. 两处 Agent Writes 句子逐字相同. 实际净增: 文档约 55 个字符 x 2 个文件.

## Comments

只改 Agent 规则, 不安排就绪审核; 按非实施工作流因改动涉及 Reviewer 权限, 启动一次 requirements-reviewer (最多一轮, 不复审). 报告只有一条: Validation 为空, 属时序安排, 已补填. 能力测试: 本改动不增删或改变任何 Reviewer 所应用的检查项, 只澄清读取义务, 未登记待测项也未运行 A/B.
