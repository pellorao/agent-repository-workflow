# 关联与审核手册对齐

Status: completed

## What to build

处理分诊 B 的 474 和 477, 同步中英文手册. application-jira 关联前提明确新增或修改的记录也须暂存为恢复基线. daily-agent-conversation-commands 说明适用 Commit Audit 的实施提交中, Code Review 的两个审核轴由 Commit Audit 统一准备并行运行, 不列为额外独立关卡. 不修改 475/476 的例外授权段落, 不改变审核规则.

预估文档净增约 1800 字符, 含本 issue.

## Acceptance criteria

- [x] Application 手册的暂存说明与关联前提及长期规范一致, 两种语言同步. 观察: 四份手册的对应段落和语言版本比较.
- [x] 日常对话手册准确说明 Code Review 与 Commit Audit 的关系, 两种语言同步, 475/476 段落保持原字节. 观察: 四份手册的对应段落和语言版本比较.
- [x] arw text check, 当前 effort 的 terms check 和仓库声明的三个生产脚本通过; 人工核对改动范围和引用. 观察: Validation 中的实际检查结果.

## Blocked by

- None - can start immediately

## Validation

- node scripts/check-workflow-distribution.mjs, node scripts/project-claude-skills.mjs --check, node scripts/generate-install-arw.mjs --check, node arw.mjs text check, node arw.mjs terms check --include .scratch/0010-triage-rule-manual-alignment/ 和 git diff --check 均通过.
- 人工核对四份手册的对应修改, 中英文含义一致. 对照 HEAD 确认日常对话手册自例外授权说明起的后续内容字节不变, 包括 475/476.

- node arw.mjs spec-readiness verify --issue issue:0010:02 通过, 引擎生成的 02.spec-readiness.json 为 satisfied.
- Main Agent 回归抽查结果: 关联前两个新记录的暂存前提仍在, 后续同步合同未改; 475/476 例外授权段落字节未变.

## Comments

- 用户已裁定纯文档免就绪与终态提交检查的冲突: 本 effort 使用严格路径取得就绪记录并运行两个提交 Reviewer, 不豁免门禁. 先前 6bb5123 按用户要求保留, 本提交补充适用范围并完成审核记录收口.
- Spec Readiness 第 2 轮原 Reviewer 返回 No problems., 已 generate, promote 并完整 verify 通过.
- Commit Audit 第 2 轮两个 Reviewer 均正常结束并返回 No problems.; Main Agent 复核限定适用范围及 475/476 段落未变.
