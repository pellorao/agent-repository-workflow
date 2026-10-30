# 规则入口与验证要求对齐

Status: ready-for-agent

## What to build

处理分诊 A 中可明确核实的 398, 399, 392. test-performance-optimization 的 Baseline 改为先按 implement 确认覆盖当前工作的已授权 issue, 不自行创建实施范围; commit 的测试回调阈值引用 test-performance-optimization 的 Threshold, 不写死 100 毫秒; resolving-merge-conflicts 的自动检查按 validation 和仓库声明选择, 不预设格式化命令. 同步 distribution 中对应 Skill Markdown 和 Claude Code 投影. 不采用上游新版本, 不修改运行时代码.

预估文档净增约 2000 字符, 含本 issue 和派生副本.

## Acceptance criteria

- [ ] 398 不再要求 Agent 自行创建 issue, 399 使用仓库阈值权威, 392 不再预设格式化命令.
- [ ] 三个 Skill 的来源, distribution 副本和 Claude Code 投影语义一致.
- [ ] arw text check, 当前 effort 的 terms check 和仓库声明的三个生产脚本通过; 人工核对改动范围和引用.

## Blocked by

- None - can start immediately
