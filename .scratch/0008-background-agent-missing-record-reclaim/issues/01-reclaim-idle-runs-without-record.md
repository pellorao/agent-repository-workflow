# 回收恢复记录缺失的空闲后台 Agent

Status: completed

## What to build

用户确认的最终状态见 effort `spec.md`: 恢复记录文件不存在的空闲运行可被容量回收, `unload_agent` 和安装维护卸载; 记录存在但不符或无法读取仍不回收. 代码 (非测试, 估算净增 0 行): `lib/background-agent/manager.mjs` 的 `safeIdle` 对 `ENOENT` 放行. 测试: 改写 "恢复目录被删除的空闲运行不回收" 的测试. 文档: `docs/specs/agent-repository-workflow/spec.md` 相应条目.

## Acceptance criteria

- [x] 满额时记录文件已删除的空闲运行被回收, 新任务获准. 观察: `tests/background-agent/manager.test.mjs` 对应测试.
- [x] 记录文件已删除的空闲运行可由 `unload_agent` 卸载 (安装维护与它们共用 `safeIdle`, 不另设测试). 观察: `tests/background-agent/manager.test.mjs` 中 `unload_agent unloads a run whose recovery record is gone`.
- [x] 记录存在但不符 (内容为 `{}`) 或无法读取 (内容不是 JSON) 的运行仍不卸载. 观察: `unload_agent refuses a run whose recovery record no longer matches it` 对两种记录都返回失败且根线程未停止.
- [x] 验证命令全部通过. 观察: `pnpm test` 与 AGENTS.md 列出的其余检查命令退出码为 0.

## Blocked by

- None - can start immediately

## Validation

- 非测试代码净增 0 行 (`safeIdle` 一行内改写, 预算估算 0 行, 未超).
- `pnpm test` 804 项 (803 通过, 1 跳过), `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `node arw.mjs text check`, `node arw.mjs terms check --include .scratch/0008-background-agent-missing-record-reclaim/` 均退出码 0.
- 验收 1: `an idle run whose recovery record is gone is reclaimed for a new run`. 验收 2: `unload_agent unloads a run whose recovery record is gone` (含卸载后 `followup_task` 的消息投递失败). 验收 3: `unload_agent refuses a run whose recovery record no longer matches it`. 验收 4: 上列命令全部退出码 0.

Spec Readiness 追溯进行 (代码先于审核): 第 1 轮 7 项 gap (含 "无法读取" 未定义, 缺 unload_agent 验收, 长期规范引用 effort, 权威来源表矛盾, 缺 Module Design 完整格式), 第 2 轮 2 项, 均已修正; 第 3 轮 `No problems.`.
