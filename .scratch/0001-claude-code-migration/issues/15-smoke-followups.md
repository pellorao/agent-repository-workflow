# 冒烟发现的日常使用问题

Status: ready-for-agent

## What to build

修复 ticket 13 两端冒烟中 Main Agent 实际遇到的问题, 让目标仓库中的日常流程不再卡住:

1. 分发文档链接到目标仓库不存在的 `docs/specs/agent-repository-workflow/spec.md`, 两个平台的 Agent 都在这里卡过: 改为目标仓库内可读的位置或删除链接.
2. `draftPath` 必须位于报告目录的规则 (`report-binding-invalid`) 没有写进文档.
3. `reviewer-launch` 没写 `wait_agent` 超时低于 10000 ms 和重复 request id 会被拒绝.
4. Codex 中 PTY canonical 模式会截断长 JSONL 请求 (需 `stty -echo -icanon`): 在 Codex 用法中写明, 或让入口不依赖长单行.
5. 新初始化的仓库上 `arw terms check` 失败 (没有术语表, 语言检查未配置): 初始化后的默认状态应能通过.
7. 用户决定 (2026-10-26): `arw background-agent` 标准输入结束时, 先等未返回的 `wait_agent` 等响应写出再退出, 不再取消; 删除 `reviewer-launch` 中的 `sleep` 绕法.
8. 审计发现: 长期 spec `docs/specs/agent-repository-workflow/spec.md:47` 仍写 Reviewer 填 Engine 清单, 改为 txt 报告.
9. 审计发现: `docs/agents/subagent-allocation.md` 只有 Codex 模型映射, 补 Claude Code 映射.
10. 审计发现: Claude 后端 Reviewer 可能加载祖先目录的 `CLAUDE.md` 和用户 memory (冒烟需用 `claudeMdExcludes` 排除): 实测 Reviewer 实际上下文, 在后端强制排除.
6. ready 记录绑定到实现文件, 实施后必须再复审一轮: 绑定只覆盖设计文档 (spec, issue), 不覆盖实现文件.

预估改动: 约 150 行.

## Spec Requirement

Governing requirements:

- `.scratch/0001-claude-code-migration/spec.md#review-workflow`

## Acceptance criteria

- [ ] 上述 10 项逐项修复或写明不修的理由.
- [ ] 修复后在隔离目标仓库用一个中等规模的真实 issue (不是玩具函数) 在 Claude Code 和 Codex 各冒烟一次, 记录耗时, Reviewer 轮数和卡住之处.
- [ ] 全量测试和分发检查通过.

## Blocked by

- 13 收尾接入
