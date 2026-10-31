# 规则文档去重清扫

Status: ready-for-agent

## What to build

反引号路径引用使被引用的规则只要长于路径就能省 token. 本项清扫 `AGENTS.md`, `docs/agents/**`, `.agents/skills/**` 中重复陈述同一规则的位置, 保留一份权威, 其余改为反引号路径引用 (语法见前置 issue 与 `docs/agents/writing.md`). 只改规则文档, 不改代码; 依据 `docs/agents/writing.md` "每个事实只保留一个权威来源" 的既有规则.

### 候选来源

此前因 "链接不比原文短" 而记 "记录不修" 的重复, 现在改用路径引用后应当处理:

- 实施者开工时先重新核对每个候选在当前文件中仍然存在, 再改动; 已不存在的剔除并在 Comments 记录.
- 权威副本选择: 持有该责任的文档保留 (如提交规则归 `commit` Skill, 编号与路径归 `issue-tracking` Skill, 子 Agent 分配归 `docs/agents/subagent-allocation.md`, 写作规则归 `docs/agents/writing.md`, 验证归 `validation` Skill); 其余位置改为引用并只保留该位置自己的增量约束.
- 重复文字不长于路径引用时不改 (收益为负).
- 新写的每处引用在文件相对形式 (`./`, `../`) 与仓库根形式 (`docs/agents/...`, `.agents/skills/...`) 中取字节数较少者 (含 `#anchor`, 相同取仓库根形式); 两种形式都由分发检查机械核对. 判断重复文字是否长于引用时, 按所取的较短形式计算.
- 只在分发载荷内可解析的路径可以出现在分发文件中: 分发的规则文档不得引用 `docs/specs/`, ADR 等 Source Checkout 专有文档作为权威 (目标仓库自有前缀除外, 见分发检查). 重复内容的另一份在长期规范里的候选 (规则文档与 `docs/specs/**` 之间) 不在本项范围, 汇总后交用户决定.

### 候选清单 (2026-10-31 重新核查仍存在, 共 17 项)

规则文档之间 (均来自 `.tmp/strata-review/triage/2026-10-31-recheck.jsonl`, 判定 real):

1. `application-workflow/SKILL.md:13-16` 与 `application-workflow/references/configuration.md:7` (仓库类型到角色映射, 不验证人员身份); 权威: configuration.md.
2. `code-maps/SKILL.md:63` 与 `validation/SKILL.md:16` (`arw code-map verify` 要求); 权威: validation.
3. `improve-codebase-architecture/SKILL.md:68` 与 `domain-modeling/SKILL.md:46` (报告仓库设置缺口); `improve-codebase-architecture/SKILL.md:14` 的 `docs/adr/` 位置; 权威: domain-modeling.
4. `improve-codebase-architecture/SKILL.md:13` 与 `improve-codebase-architecture/HTML-REPORT.md:110-112` 对 `codebase-design/SKILL.md:12` 词汇规则的复述; 权威: codebase-design.
5. `issue-tracking/SKILL.md:42`, `:51-53` 与长期规范同一规则 (属规则文档与规范之间, 汇总交用户决定, 不在本项改).
6. `resolving-merge-conflicts/SKILL.md:14` 与 `commit/SKILL.md:8` (用户请求后才进入提交流程); 权威: commit.
7. `rule-and-design-changes/SKILL.md:18` 与 `docs/agents/subagent-allocation.md:6` (spec 修改共同决定者的模型与推理强度); 权威: subagent-allocation.
8. `test-performance-optimization/SKILL.md:62` 与 `test-value-cleanup/SKILL.md:48`; 权威: test-value-cleanup.
9. `to-spec/SKILL.md:78` 与 `docs/agents/writing.md` 规范设计呈现一节的交付前自检; 权威: writing.md.
10. `to-tickets/SKILL.md:69` 与 `issue-tracking/SKILL.md:12,13,16` (effort 编号, 路径, 编号即身份); 权威: issue-tracking.
11. `to-tickets/SKILL.md:72` 与 `implement/SKILL.md:16` (阻断项均已终态才处理); 权威: implement.
12. `to-tickets/SKILL.md:23` 与 `:34` (先重构规则在同文件出现两次); 保留一处.
13. "不含文件路径和代码片段" 规则: `to-spec/SKILL.md:52,54`, `to-tickets/SKILL.md:99`, `triage/AGENT-BRIEF.md:15,204`; 权威: to-spec.
14. `triage/OUT-OF-SCOPE.md:72` 与 `triage/SKILL.md:70` (先前拒绝检查, 并含硬编码步骤编号); 权威: triage SKILL.
15. `validation/SKILL.md:12-16` 与长期规范同一检查集 (规则文档与规范之间, 同第 5 项, 交用户决定).
16. `wayfinder/SKILL.md:15` 与 `commit/SKILL.md:13` (候选分类); 权威: commit.
17. `release/` 全目录与 release 规范 (规则文档与规范之间, `release` 不分发, 同第 5 项, 交用户决定).

上表中第 5, 15, 17 项属规则文档与规范之间的重复, 本项只汇总不改, 实际处理 14 项.

仅出现在 2026-10-30 台账或分流记录, 尚未重新核查 (实施者先核查再处理, 约 24 项):

- `docs/agents/subagent-allocation.md:77` 复述 `:56` 的 Fast 说明 (Repository-owned 区域复述 Baseline); `AGENTS.md:62` 与 `docs/agents/subagent-allocation.md:46` 触发条件重复.
- 单 Agent 规则复述: `docs/agents/reviewer.md:38` (权威), `docs/agents/agent-writes.md:8,26`, `docs/agents/subagent-allocation.md:6`; 另有 Reviewer 角色文件的两处 (见下).
- `application-workflow`: `SKILL.md:9` 与 `references/configuration.md:3,25`; `references/jira-acceptance.md:20,24-29` 与 `references/jira-completion.md:14`; `references/association-and-distribution.md:46` 与 `arw-commands/SKILL.md:8,41`; `references/module-correction.md:12` 与 `issue-tracking/SKILL.md:28`; `references/configuration.md:33` 与 `references/synchronization.md:5` 等处的前置条件.
- `codebase-design/DEEPENING.md:29` 与 `codebase-design/SKILL.md:65`; `tdd/mocking.md:16-35` 与 `codebase-design/SKILL.md:67-80`.
- `domain-modeling/SKILL.md:74-80` 与 `ADR-FORMAT.md:29-37`, `SKILL.md:46` 与 `ADR-FORMAT.md:5`, `CONTEXT-FORMAT.md:59`; `improve-codebase-architecture/SKILL.md:70` 与 domain-modeling 的 ADR 条件; `improve-codebase-architecture/SKILL.md:43-52` 与 `HTML-REPORT.md:44-53` 候选卡片.
- `prototype/SKILL.md:16-30` 与 `LOGIC.md`, `UI.md` 相应行; `teach/SKILL.md:15-19` 与 `LEARNING-RECORD-FORMAT.md`, `RESOURCES-FORMAT.md`, 同文件内 `:17` 与 `:48`, `:19` 与 `:137-139`.
- `wayfinder/SKILL.md:61,95,113,115` 与 `issue-tracking/SKILL.md` 的 Wayfinding 一节; `wayfinder/SKILL.md:67,105` 保存路径出现两次; `research/SKILL.md:12`.
- `validation/SKILL.md:20` 与 `issue-tracking/SKILL.md` 的 `## Validation` 规则; `writing-for-agents/SKILL.md:78` 与 `docs/agents/writing.md` 单一权威来源条; `test-performance-optimization` 与 `commit/SKILL.md:20` 对 100 毫秒阈值的硬编码.
- 台账 "记录不修": `upstream-sync/SKILL.md:22,61` 的会话身份说明与完整路径重复 (`.scratch/0010-triage-rule-manual-alignment/issues/03-clarify-remaining-triage-evidence.md` 台账).

### Reviewer 规则文件 (标记, 不在默认范围)

`docs/agents/roles/code-standards-reviewer.md:43,45` 复述 `docs/agents/writing.md` 与 `AGENTS.md` 的效率规则; `docs/agents/roles/code-standards-reviewer.md:61` 与 `docs/agents/roles/spec-readiness-reviewer.md:89` 复述单 Agent 规则; `docs/agents/reviewer.md` 的共同规则. 按 `AGENTS.md`, 改动 Reviewer 规则须做能力对比 (评分不降低才接受), 只删重复或改为引用且不改变任何规则含义时免测. 本项默认不改 Reviewer 角色文件; 若用户决定纳入, 逐处证明含义不变, 否则走能力对比.

### 体积预算

文档任务按字符计. 每处替换为路径引用后只应减少字符; 预计净减约 3000-6000 字符 (按 14 项已核查加约 24 项待核查估算), 预算: 文档净增量不超过 0 字符. 某处替换使字符增加则不做该处. 不抵扣无关的冗余删除; 能分开时单独提交. 因复制变引用而需要的增量约束保留原文.

### 预期验证与边界情况

- 改规则文档后重新运行 `node scripts/sync-workflow-distribution.mjs` 与 `node scripts/project-claude-skills.mjs`, 再运行 `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `arw text check`, `arw terms check`, `git diff --check`; 无代码改动, 不要求 `pnpm test` 新增测试, 但提交前仍按 Source Checkout 验证约定运行完整 `pnpm test` 与 `pnpm typecheck`.
- 每处替换后, 被引用的位置必须真的包含被删文字的全部含义 (逐项核对); 被删位置自己的增量约束不得丢失; 分发载荷内的引用只指向载荷内路径.
- 边界: 两份文字措辞不同但约束强度不同 (如 `codebase-design` 与 `DEEPENING.md` 的适配器数量) 属于冲突不是单纯重复, 不自行取舍, 汇总交用户决定; 复述跨 Skill 但被引用 Skill 不随分发一起安装时不得引用 (先查分发配置).
- 规则文档和 `AGENTS.md` 修改不逐处预先确认 (见 `AGENTS.md` Autonomous Working Mode), 由用户在状态页复核整体 diff. 本项只改规则与文档, 不需要 Spec Readiness.

## Acceptance criteria

- [ ] 17 项已核查候选与约 24 项待核查候选都已处理或在 Comments 中逐项说明保留原因 (已不存在, 复述长度不足以抵路径引用, 属冲突或规范之间重复).
- [ ] 保留的权威位置正确, 被改位置的增量约束未丢失, 引用均为前置 issue 规定的反引号路径, 取两种形式中较短者, 且在分发载荷内可解析.
- [ ] Reviewer 角色文件未改动, 或已按能力对比规则处理并记录.
- [ ] 必要验证通过, 文档净增量不超过 0 字符.

## Blocked by

- 01 - 规则文档改用反引号路径引用
