# 规则入口与验证要求对齐

Status: completed

## What to build

处理分诊 A 中可明确核实的 398, 399, 392. test-performance-optimization 的 Baseline 改为先按 implement 确认覆盖当前工作的已授权 issue, 不自行创建实施范围; commit 的测试回调阈值引用 test-performance-optimization 的 Threshold, 不写死 100 毫秒; resolving-merge-conflicts 的自动检查按 validation 和仓库声明选择, 不预设格式化命令. 同步 distribution 中对应 Skill Markdown 和 Claude Code 投影. 不采用上游新版本, 不修改运行时代码.

预估文档净增约 2000 字符, 含本 issue 和派生副本.

## Acceptance criteria

- [x] 398 不再要求 Agent 自行创建 issue, 399 使用仓库阈值权威, 392 不再预设格式化命令. 观察: 三个 Skill 的对应规则及副本检查.
- [x] 三个 Skill 的来源, distribution 副本和 Claude Code 投影语义一致. 观察: 三个 Skill 的对应规则及副本检查.
- [x] arw text check, 当前 effort 的 terms check 和仓库声明的三个生产脚本通过; 人工核对改动范围和引用. 观察: Validation 中的实际检查结果.

## Blocked by

- None - can start immediately

## Validation

- node scripts/check-workflow-distribution.mjs, node scripts/project-claude-skills.mjs --check, node scripts/generate-install-arw.mjs --check, node arw.mjs text check, node arw.mjs terms check --include .scratch/0010-triage-rule-manual-alignment/ 和 git diff --check 均通过.
- 人工核对三处 Skill 修改与 issue 要求一致, 来源与 distribution 副本字节相同, Claude Code 投影检查通过. 只调整规则引用, 未修改测试或运行时代码.

- node arw.mjs spec-readiness verify --issue issue:0010:01 通过, 引擎生成的 01.spec-readiness.json 为 satisfied.
- Main Agent 抽查: test-performance-optimization 的入口不再创建授权范围; commit 阈值引用仍保留目标仓库声明及默认阈值合同; 合并验证只选择仓库声明的命令.

## Comments

- 用户已裁定纯文档免就绪与终态提交检查的冲突: 本 effort 使用严格路径取得就绪记录并运行两个提交 Reviewer, 不豁免门禁. 先前 1c35e70 按用户要求保留, 本提交为该 issue 完成审核和记录收口.
- Spec Readiness 第 2 轮原 Reviewer 返回 No problems., 已 generate, promote 并完整 verify 通过.
- 提交审核第 2 轮的要求符合审核与 Code Standards 均为 No problems. 原 Reviewer 已撤回对观察说明的错误要求; 旧验证记录已清理. arw commit-audit verify 返回空错误列表, subject-only 就绪核对通过. 报告位于当前会话 _commit-audit/2 的两个 Reviewer 目录.
