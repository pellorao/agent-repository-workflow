# 修复审核环与验收项的两处规则冲突 (G05, G06)

Status: completed

## What to build

修 E5b 实验发现且 HEAD 核对仍在的两处规则冲突, 它们让会话停下问用户或使审核环不收敛. 修复方向来自 0099 issue 23 的待修清单, 本 issue 不含设计决定.

G05: 实施开始后, 提交审核提出的只涉及 issue subject 措辞, 重复或一致性 (不改变范围, 行为或验收含义) 的问题, 任何轮次都可按 `commit` Skill 的处置台账记 `台账: ... 记录不修 ...`, 不修改 subject; 其他措辞, 重复和文档去重类问题仍从第 3 轮起才可记 "记录不修". 改 `spec-readiness/SKILL.md` Authorization timing 节与 `issue-tracking/SKILL.md` 记录章节, 使其指向该台账格式; 改 `commit/implementation-workflow.md` 提交门槛与 `commit/fix-rounds.md` 的轮次规则; 长期规范 `docs/specs/agent-repository-workflow/spec.md` 的提交门槛句同步.

G06: 验收标准不得以提交及其后才产生的事实 (Commit Audit 通过, 提交本身, 提交号, 推送) 或其他审核的结果为条件; 这些写入预期验证. 改 `issue-tracking/SKILL.md` 的写作规则, 删除该文件中允许 "正式验收以某审核通过为条件" 的句子; `docs/agents/roles/requirements-reviewer.md` 把这类验收项写成 issue 自身的问题 (应移入预期验证), 不要求在受审树上核对; `lib/spec-readiness/precheck.mjs` 对这类验收项给出 `warning:`, 并补测试. 在 `docs/agents/source-checkout-reviewer-testing.md` 待测表登记本次对检查项的改动. 同步 `distribution/` 副本与 `.claude/skills` 投影.

体积预算: 非测试代码净增 4 行以内; 文档净增约 1500 字符; 测试约 10 行.

预期验证: `pnpm test`, `pnpm typecheck`, 分发与投影检查, `arw text check`, `arw terms check`, `git diff --check`, Commit Audit; 定向运行 `tests/spec-readiness/precheck.test.mjs`.

## Acceptance criteria

- [x] 观察: 上述五处 G05 文本与规范对第 1, 2 轮的措辞类问题给出一致处置, 不再互相矛盾.
- [x] 观察: `issue-tracking/SKILL.md` 与 `requirements-reviewer.md` 对后于提交产生的事实和其他审核结果类验收项一致 (不得写, Reviewer 写成问题), 且不再有允许以审核通过为验收条件的句子.
- [x] 观察: `precheck` 对以后于提交产生的事实或其他审核结果为条件的验收项给出 `warning:`, 对普通验收项不报; `tests/spec-readiness/precheck.test.mjs` 覆盖.
- [x] 观察: 分发与投影检查, `pnpm test`, `arw text check`, `arw terms check` 通过.

## Blocked by

- None - can start immediately

## Validation

- `pnpm test`: tests 957, pass 957, fail 0; `pnpm typecheck` 通过; `node tests/spec-readiness/precheck.test.mjs` 3 个案例通过, 新增案例 1 个 (不起真进程).
- `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `arw text check` (`node arw.mjs text check`), `arw terms check` (`node arw.mjs terms check --include .scratch/0121-rule-conflict-fixes/`), `git diff --check`, `node --check lib/spec-readiness/precheck.mjs` 通过.
- 改动量: 非测试代码净增 1 行 (预算 4), 测试 13 行; 文档按 `prepare` 实测 1180 字符, 其中 `.agents`, `.claude`, `distribution` 副本重复计数, 源文件净增约 350 字符 (预算 1500).

候选实测摘要:

```text
code: +1 lines (files: 1)
  lib/spec-readiness/precheck.mjs +1
documents: +1180 characters (files: 16)
tests: +13 lines (files: 1)
  tests/spec-readiness/precheck.test.mjs +13
next ADR number: 0041
```

## Comments

- 来源: 任务 `ARW/g56fix`, 依据 0099 issue 23 待修清单. 无设计决定, 单 effort 单 issue, 使用 Spec Readiness `not-applicable` 例外 (用户 2026-11-02 对这类 issue 的常设确认). 因含对 Reviewer 检查项的改动, 能力 A/B 不在本任务做, 登记待测.
- 台账: .agents/skills/commit/fix-rounds.md:5, .agents/skills/commit/implementation-workflow.md:11, .agents/skills/spec-readiness/SKILL.md:14, docs/specs/agent-repository-workflow/spec.md:533 记录不修 四处各自陈述同一处置规则, 它们分别是所属工作流的入口, 语义与情态已统一, 同类重复在本次变更前已存在, 抽成单一权威句会扩大范围.
- 台账: lib/spec-readiness/precheck.mjs:36 冲突裁决 Code Standards 要求不为未被测试用例支撑的措辞加选项, 要求符合审核要求逐轮补全更多措辞, 二者对同一正则互相冲突; 按本 issue 的目标 (自查警告, 识别审核名称后紧跟 通过 或 无问题 的固定搭配, 含 结果为, 已, 全部) 保持现状, 其余措辞由要求符合审核在提交审核中报为 issue 问题.
