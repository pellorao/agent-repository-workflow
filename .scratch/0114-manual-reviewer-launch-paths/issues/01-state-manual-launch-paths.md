# 写明手工启动 Reviewer 的路径与交接要求

Status: completed

## What to build

`.agents/skills/reviewer-launch/other-reviews.md` 描述没有 `prepare` 的手工启动, 但没写运行层强制的路径位置和 Reviewer 取得报告位置的唯一途径. 运行层 (`lib/reviewer-runtime/reviewer-runtime.mjs` 的 `readHandoff`, `spawn`) 要求 `writePaths` 在仓库 `.tmp/` 之内, `stateDirectory` 在当前会话工作区 `.tmp/<平台>/<sessionId>/` 之内 (否则 `invalid-input`); 运行层不把 `reportPath` 告诉 Reviewer, 只有 `handoff` 正文能告诉它 (`prepare` 生成的请求在正文末尾写 `报告: <路径>`). ARW/revwrite 11-09 手工启动 requirements-reviewer 时连续因此失败. 在该文件的 `handoff`, `writePaths`, `stateDirectory` 三处各补一句, 同步 `.claude/skills` 投影和 `distribution/skills` 副本.

预估净增: 文档约 150 个字符 x 3 个文件. 不涉及代码, 规范或设计决定; 只改 Agent 规则, 不安排就绪审核. 改动确认: Main Agent 已按最小改法确认 (`docs/ARW.md` 本机例外).

## Acceptance criteria

- [x] 三处措辞与运行层校验一致, 三份副本相同.
- [x] 分发检查, 文本检查通过.

## Blocked by

- None - can start immediately

## Validation

- `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `node arw.mjs text check`, `git diff --cached --check`, `node arw.mjs commit-audit verify --non-implementation` 通过 (最后一项错误列表为空). 未运行 `pnpm test`: 只改 Markdown. 三份副本逐字相同. 实际净增: 文档约 190 个字符 x 3 个文件.

## Comments

不补 "之前的线程不能复用" 和 "isolated 身份": 前者已由该文件末句 (`runId` 复审, 仅在原线程不可用时 `newThread`) 覆盖, 同会话重复 spawn 同一身份得到 `reviewer-identity-exists` 属该规则的结果; 后者是 Capability 和基准的身份, 普通审核用 ordinary, 在文档里推荐 isolated 会与现有 `identity` 规则矛盾. 能力测试: 不增删或改变 Reviewer 所应用的检查项, 只对齐 Main Agent 填 Request 字段的要求与运行层校验, 未登记待测项也未运行 A/B (Main 复核).

requirements-reviewer 一轮 (手工启动, 不复审): 报告一条, 指出 `writePaths` 写成必须位于当前会话工作区, 而运行层只要求在仓库 `.tmp/` 内 (`reviewer-runtime.mjs` 的 `readHandoff`), 会话工作区约束只作用于 `stateDirectory`; 属实, 已把三份副本改为 "位于仓库 `.tmp/` 之内, 一般放在当前会话工作区下". 修正后未再审.
