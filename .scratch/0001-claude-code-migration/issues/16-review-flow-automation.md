# 审核流程的机械步骤交给程序

Status: ready-for-agent

## What to build

独立审计估算一张典型 ticket 要 5 到 8 次 Reviewer 会话, 15 到 30 分钟, Main 还要做 30 到 50 次机械工具调用 (拼完整 `instructions` 的 JSONL, 复制带 SHA-256 的规则副本, 等待, generate/promote/verify). 把这些机械步骤交给程序:

- `arw commit-audit prepare` 和 Spec Readiness 的准备步骤一次完成规则副本, 哈希和空报告, 并输出可直接发给 `arw background-agent` 的 spawn 请求; Main 只提供路径.
- 非实施提交的 6 步手工机械检查改为一条命令.
- 规则和 Skill 中对应的手工步骤删除.

目标: 一张典型 ticket 的 Main 机械工具调用减半以上, 在 15 的中等规模冒烟上对比测量.

预估改动: 净减.

## Spec Requirement

Governing requirements:

- `.scratch/0001-claude-code-migration/spec.md#review-workflow`

## Acceptance criteria

- [ ] Main 不再手工拼 spawn 请求和规则副本.
- [ ] 非实施提交检查是一条命令.
- [ ] 同一中等规模 issue 上, Main 工具调用数和耗时相对 15 的冒烟明显下降, 数据记入 `## Comments`.
- [ ] 全量测试和分发检查通过.

## Blocked by

- 15 冒烟发现的日常使用问题
