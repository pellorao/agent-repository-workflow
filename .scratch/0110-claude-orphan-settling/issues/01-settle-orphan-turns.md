# 查询或等待时收敛 Claude 孤立回合

Status: completed

## What to build

修复 `.tmp/triage.md` 的 J: 管理进程重启后仍存活的 Claude 孤立回合进程结束时, `list_agents` (概览和指定运行) 与 `wait_agent` 无需再次重启即可确认退出. 已登记的等待必须在进程结束后返回, 不等到请求超时. 仍存活的进程保持未知状态及容量占用. 复用既有恢复逻辑, 不恢复或重放原生工作, 不更改 Codex 行为.

本 issue 独占一个无 spec 的 effort. 用户已确认现有规范规定此行为, 没有新设计决定, 按 Spec Readiness 例外流程生成 `not-applicable` 记录.

体积预算: 非测试代码净增不超过 30 行; 预计测试净增 65 行, issue 文本约 1500 字符. 定向验证使用 `tests/background-agent/manager.test.mjs` 的模拟进程和时钟, 不启动真实 Claude. 完成前运行完整 Source Checkout 验证及双 Reviewer Commit Audit.

## Acceptance criteria

- [x] 孤立进程存活时查询保持未知, 不启动或恢复原生进程.
- [x] 孤立进程结束后, 概览不再列出该运行, 指定运行查询返回 `exited`, 并推进观察 cursor.
- [x] 等待已登记后进程结束, `wait_agent` 在请求超时之前返回退出状态; 支持取消, 并清除等待定时器.
- [x] 使用既有恢复结果表示未完成任务, 停止累计已退出任务的耗时; 原有容量回收和 Codex 测试通过.
- [x] 定向测试和完整 Source Checkout 验证通过.

## Blocked by

- None - can start immediately

## Validation

- `pnpm typecheck` 通过.
- `pnpm test` 通过: 942 个测试, 0 失败, 0 跳过. 包含 Codex 原有行为及 Claude 模拟进程覆盖, 没有启动真实 Claude.
- 定向命令 `node --test --test-reporter=spec --test-name-pattern='Claude orphan ending' tests/background-agent/manager.test.mjs` 通过, 三个回调分别约 10, 4, 5 毫秒. 最终定向运行和完整套件均包含存活进程轮询断言.
- 三项分发检查, 两个受影响文件的 `node --check`, 术语检查, `arw text check` 和 `git diff --check` 通过. 新 issue 的语言检查为中文 82.9%.
- 回归测试覆盖存活期间未知状态和概览占用, 概览及指定查询确认退出, 等待期间轮询存活后结束, 取消及定时器清理, cursor 推进, 结束时间记录, 以及零原生启动.
- 预计改动净增: 代码 30 行, 测试 65 行, issue 文本约 30 行 (1500 字符). 实际改动净增: 代码 13 行, 测试 49 行; issue/doc 文本净增 49 行, 无长期文档变更.

候选实测摘要 (引擎不将 issue 文本计入 documents):

```text
code: +13 lines (files: 1)
  lib/background-agent/manager.mjs +13
documents: 0 characters (files: 0)
tests: +49 lines (files: 1)
  tests/background-agent/manager.test.mjs +49
next ADR number: 0041
```

## Comments

本轮只处理 J, 后续 K 和 L 各自创建独立 effort, 按 `.tmp/triage.md` 执行. 用户授权修改 `lib/background-agent/manager.mjs` 及其测试, 禁止安装或修改已安装文件. 基线为干净的已提交工作树.

Commit Audit 第 2 轮: Code Standards 和要求符合 Reviewer 均返回 `ready`, 两份报告均为 `No problems.`. 固定比较为 `9cfd2b38257d5ea3fe797639de5d950dfdb26d72` 到 `a431e4cc7709d1ba4eb079df4ca797e9f39d328e`. 抽查现有冷启动容量回收测试, 存活进程保留及不启动原生进程的断言, 并核对轮询退出与取消清理. 第 1 轮仅补齐引擎摘要后重新准备, 未启动 Reviewer.
