# 关联与审核手册对齐

Status: ready-for-agent

## What to build

处理分诊 B 的 474 和 477, 同步中英文手册. application-jira 关联前提明确新增或修改的记录也须暂存为恢复基线. daily-agent-conversation-commands 说明提交时 Code Review 的两个审核轴由 Commit Audit 统一准备并行运行, 不列为额外独立关卡. 不修改 475/476 的例外授权段落, 不改变审核规则.

预估文档净增约 1800 字符, 含本 issue.

## Acceptance criteria

- [x] Application 手册的暂存说明与关联前提及长期规范一致, 两种语言同步.
- [x] 日常对话手册准确说明 Code Review 与 Commit Audit 的关系, 两种语言同步, 475/476 段落保持原字节.
- [x] arw text check, 当前 effort 的 terms check 和仓库声明的三个生产脚本通过; 人工核对改动范围和引用.

## Blocked by

- None - can start immediately

## Validation

- node scripts/check-workflow-distribution.mjs, node scripts/project-claude-skills.mjs --check, node scripts/generate-install-arw.mjs --check, node arw.mjs text check, node arw.mjs terms check --include .scratch/0010-triage-rule-manual-alignment/ 和 git diff --check 均通过.
- 人工核对四份手册的对应修改, 中英文含义一致. 对照 HEAD 确认日常对话手册自例外授权说明起的后续内容字节不变, 包括 475/476.
- 本次只提交符合非实施分类的规则与文档及验证记录. 未运行 Reviewer, 未生成就绪记录, issue 保持原状态; 终态提交的规则冲突尚待用户裁定.
