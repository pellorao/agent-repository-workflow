# 就绪审核首轮前 Main 自查测试观察与 ADR 清点

Status: completed

## What to build

本 issue 只改 Agent 规则 Markdown, 按 `commit` Skill 的非实施工作流提交, 不安排 Spec Readiness. 问题: 就绪审核是功能类 issue 最大的耗时段, 首轮发现中有一类 Main 写 spec 时可机械自查: issue:0023:03 首轮 12 条 gap 中 4 条是 "spec 规定了某失败结果但测试段没有对应观察", 2 条是 "ADR 评估没有逐项清点新的权威或恢复合同".

改动: `spec-readiness` Skill `Prepare and review` 节第 2 条 `prepare` 前自检的末尾, 在 "设计依赖的外部事实 ... 已在 Input 中" 之后追加: "spec 与 issue 写明的每个失败, 拒绝和边界结果, 测试段都有对应观察; `ADR Evaluation` 逐项列出本次改变的权威来源, 持久状态和恢复合同". 三个副本逐字相同: `.agents/skills/spec-readiness/SKILL.md`, `.claude/skills/spec-readiness/SKILL.md`, `distribution/skills/spec-readiness/SKILL.md`. 只提高 Main 提交给 Reviewer 的输入质量, 不改 Reviewer 指令和就绪判断标准.

体积预算 (文档字符, 含两份副本): 净增约 +260 (每份约 87); 上限 +330.

预期验证: `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `arw text check`, `arw language inspect`, 提交前 `arw commit-audit verify --non-implementation`. 不改 Reviewer 规则, 不做能力对比; 草稿建议的历史回放 (用清单处理 0023-03 首轮前的 subject, 统计可预先消除的 gap) 不是规则要求的验证, 且结果取决于执行者的自查质量, 本 issue 不做, 收益以后用实际首轮 gap 数观察. 边界情况: 三个副本逐字一致; 原有自检各项文字不变.

## Acceptance criteria

- [x] 三个副本的自检条含上述新文字, 原有文字未变.
- [x] 预期验证中的命令全部成功; `arw commit-audit verify --non-implementation` 需要已暂存候选, 由 Main 提交前运行.

## Blocked by

- None - can start immediately

## Validation

- 验收条件 1: `git diff --stat` 为三个文件各 1 行替换; 脚本断言旧句各出现 1 次后替换.
- 验收条件 2: `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `arw text check` 均通过; `arw language inspect` 中文 82.0%, 英文 18.0% (命令, 字段名等精确文字). `arw commit-audit verify --non-implementation` 未运行 (候选未暂存).
