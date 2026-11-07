# 体积 warning 先改再审, 缺摘要块也提示, 台账措辞澄清

Status: completed

## What to build

本 effort 只含本 issue, 不创建 spec, 不含设计决定, 不改 Reviewer 规则; 就绪审核通过例外流程记录 `not-applicable` (用户 2026-11-02 的常设确认). 依据: 11-07 的提交审核共有 4 条体积类发现 (数字缺记录或过期), 都是 `prepare` 已给出 warning 或本可给出 warning 时 Reviewer 才发现; 只为台账或记录差异多开轮次来自对 `implementation-workflow.md` 第 5, 6 步的误读.

- `.agents/skills/commit/implementation-workflow.md` Run 第 1 步: 按 `prepare` 的体积 `warning:` 先改 Validation, 重新 `prepare`, 再启动 Reviewer; 摘要块原样复制.
- `lib/commit-audit/commit-audit.mjs` 的 `recordWarnings`: Validation 非空白而没有任何摘要块行 (`code: N lines`, `documents: N characters`, `tests: N lines`) 时也给一条 warning, 并在 `docs/specs/agent-repository-workflow/spec.md` 的 prepare 摘要段加 (c) 一句 (加测试). Validation 缺失或为空白仍按空文本处理.
- 澄清措辞: 只改 Validation 和 Comments (含冲突裁决台账) 不需要复审, "在 `prepare` 前暂存" 只适用于因其他原因再开的一轮, 不表示记台账本身要再开一轮 (`implementation-workflow.md` 第 5, 6 步, `issue-tracking/SKILL.md` Issue record sections 节).

改动文件: 上述 Skill/文档及其投影 (`.claude/skills`, `distribution`), `commit-audit.mjs`, `docs/specs/agent-repository-workflow/spec.md` 的 prepare 摘要段, `tests/commit-audit/cli.test.mjs`.

体积预算: 非测试代码约 +4 行 (`recordWarnings`); 文档约 +600 字符 (含投影和分发副本的重复).

## Acceptance criteria

- [x] `prepare` 在 Validation 非空白而没有摘要块时输出 warning, 有摘要块或 Validation 缺失时不输出; 有测试, 规格已同步.
- [x] `implementation-workflow.md` 写明先按 warning 改 Validation 再重新 `prepare` 后启动 Reviewer, 以及记录差异 (含台账) 不需要复审.
- [x] 投影与分发副本一致, 完整 Source Checkout 验证通过, 完成记录含体积分类.

## Blocked by

- None - can start immediately

## Validation

- `pnpm typecheck` 通过; `pnpm test` 935/935 通过 (`node --test tests/commit-audit/*.test.mjs` 29/29, 新增 Validation 非空白且无摘要块时 warning 的一个测试).
- `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `node arw.mjs text check`, `node arw.mjs terms check`, `git diff --cached --check`: 通过.
- 体积摘要:

```
code: +1 lines (files: 1)
  lib/commit-audit/commit-audit.mjs +1
documents: +631 characters (files: 7)
  .agents/skills/commit/implementation-workflow.md +147
  .agents/skills/issue-tracking/SKILL.md +13
  .claude/skills/commit/implementation-workflow.md +147
  .claude/skills/issue-tracking/SKILL.md +13
  distribution/skills/commit/implementation-workflow.md +147
  distribution/skills/issue-tracking/SKILL.md +13
  docs/specs/agent-repository-workflow/spec.md +151
tests: +7 lines (files: 1)
  tests/commit-audit/cli.test.mjs +7
next ADR number: 0041
```

## Comments
- 就绪记录为 `not-applicable` 例外 (用户 2026-11-02 常设确认). Agent 规则与规格改动由 Main Agent 确认等同用户确认 (Source Checkout Baseline 例外).
- 第 1 轮提交审核: 要求符合审核指出新 warning 与规格 `:527` 的 "章节缺失按空文本处理" 不符; 已改为只在 Validation 非空白时提示, 并在规格加 (c) 一句. 其余发现 (issue 文件被截断, 台账措辞重复) 已修复.
- 0104 第 21 轮 `01.spec-readiness.json` subject sha 变化: 该轮 issue 相邻 diff 只改了 Validation 和 Comments, 现有代码中 subject 只由 What to build 到 Acceptance criteria (任务标记已规范化) 计算, 所以旧记录的 sha 在更早就与 issue 不符 (推断, 未复现), 到提交前 `verify --subject-only` 才重新生成记录. 未发现引擎缺陷, 不改代码.
- 体积: 实测代码 +1 行 (预算约 +4), 文档 +631 字符 (预算约 +600, 超出的 31 字符是规格 (c) 句), 无需削减.
