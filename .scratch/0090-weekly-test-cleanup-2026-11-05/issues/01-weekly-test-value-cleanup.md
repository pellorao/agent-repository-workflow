# 每周精简测试 (2026-11-05)

Status: completed

## What to build

按 `test-value-cleanup` Skill 做本周清理. 维护者另定本次目标: 只删确属低价值的测试, 不套默认 20%; 再按 `test-performance-optimization` 的 Iteration 优化最慢的回调; 验收目标是 `pnpm test` 三次连续通过且墙钟中位数低于 5 秒. 生产代码启动 Git 与子进程造成的慢案例按 issue `0025:02` 的维护者决定处理: 用 mock 降耗时, 不改生产代码, 做不到 100 毫秒以下的保留并记录.

本次起点: HEAD `646148a`, 普通独立叶子案例基数 N 为 906 (`pnpm test` 报告的 tests 数, 无套件父回调, 无跳过).

范围只含 `tests/` 下的测试文件; 不改生产代码.

体积预算: 非测试代码净增 0 行 (只改测试).

预期验证: `pnpm test` 三次, `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `git diff --check`.

## Acceptance criteria

- [x] 每个被删除的案例在 `## Comments

删除案例: 无 (基数 906, 结束 906). 逐项检查测试名与代表性案例后, 没有发现仅复述配置值或被更小代表完整覆盖的案例; 上周提交审核曾恢复两个看似低价值的删除, 本次不重复冒险.

慢案例本周未逐例迭代: `pnpm test` 中位数 3.24 秒, 远低于 5 秒目标; 上表多数案例启动真实子进程或 Git (安装进程, 后台 Agent 宿主, 子模块协调, init), 按 `0025:02` 的维护者决定在上周已用 mock 处理过可处理部分 (`62e3681`); 其余 (Reviewer 能力测试的 pool 与 setup 案例, Spec Readiness CLI 案例, format-penalty 归档评分案例) 是生产代码的解析与计算, 留给下次每周清理逐例测量.
