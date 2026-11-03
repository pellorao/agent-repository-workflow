# 修复 commit-audit 新轮编号

Status: completed

## What to build

`arw commit-audit prepare` 在会话工作区 `_commit-audit/` 下新建审核轮目录时, 用数字目录个数加 1 编号 (`prepareCommitAudit`), 而 `verify` 取编号最大的轮核对受审版本. 轮目录编号有空缺时 (例如旧轮被清理后剩 1 到 11, 22, 83 到 92), 新轮被建成 23, `verify` 却读取过期的 92, 报 "HEAD changed" 和全部暂存路径已变; 个数加 1 恰好等于已有目录时 `mkdir` 还会失败.

改为新轮编号取现有数字目录的最大编号加 1, 没有轮目录时为 1. `verify` 取最大编号的行为不变. 其他按目录编号的写法已核查: Spec Readiness 的审核轮目录用 `requestId` (UUID) 命名, 不按个数编号, 无同类问题.

预期验证: Commit Audit CLI 测试增加一个编号有空缺的测试 (已有轮 1 和空缺后的 7, 新轮必须是 8 且 `verify` 通过), 不新增真实进程或 Git 运行, 测试回调低于 100 毫秒.

体积预算: 非测试代码净增 0 行 (替换 1 行表达式).

## Acceptance criteria

- [x] 会话工作区已有数字目录 `1` 和 `7` 时, 新建的审核轮是 `_commit-audit/8`, 并且在该轮写好两份报告后 `arw commit-audit verify` 无错误.
- [x] 没有任何轮目录时首轮仍是 `_commit-audit/1`, 连续 `prepare` 仍依次得到 `1`, `2`.
- [x] `pnpm test` 中 Commit Audit CLI 测试全部通过, `pnpm typecheck` 通过.

## Blocked by

- None - can start immediately

## Validation

- 先加测试后修复: 修复前 Commit Audit CLI 测试文件中新测试失败 (新轮被建成 `_commit-audit/3`), 修复后该文件 16 项全部通过.
- `pnpm test`: 871 项通过, 0 失败, 总耗时约 3 秒; `pnpm typecheck` 通过.
- 实测非测试代码净增: `git diff --numstat -- lib` 为 1 行新增, 1 行删除, 净增 0 行, 在预算内.
- `arw spec-readiness verify --issue issue:0060:01` 退出码 0 (`not-applicable` 例外记录).
- 验收逐条证据: 第 1 条为 `tests/commit-audit/cli.test.mjs` 的 `prepare numbers a new round after the highest existing one, so verify checks the round it just created` (已有 `1` 与 `7` 时新轮为 `8`, verify 无错误), 回调实测 43 毫秒; 第 2 条为同文件 `prepare writes a fixed-version round for both Reviewers and follows up their threads in the next round` (首轮 `1`, 次轮 `2`), 59 毫秒; 第 3 条见上两行. 耗时用 `node --test --test-reporter=spec tests/commit-audit/cli.test.mjs` 测量, 均低于 100 毫秒阈值.
- `arw text check` 通过; `arw terms check --include .scratch/0060-commit-audit-round-number/` 通过; `arw language inspect` 本 issue 中文 85.4%.

## Comments

- Spec Readiness: 本 effort 只含这一个不含设计决定的 issue, 按用户 2026-11-02 对这类 issue 的常设确认记为 `not-applicable` 例外, 不跑就绪审核; `exception.confirmedAt` 写该常设确认的用户原话时刻 2026-11-01T17:01:05Z (提交审核第 1 轮要求符合审核指出原先写的当日零点不是确认时间, Main 按会话记录改正并重新 generate 与 promote).
- 同类写法核查: 仓库中只有 `prepareCommitAudit` 按目录个数给轮目录编号; Spec Readiness 的轮目录以 `requestId` 命名, 无需修改.
- 第 2 轮处置: `## What to build` 的 "预期验证" 中 "不新增真实进程或 Git 运行" 一句不准确; `prepare` 与 `verify` 只读已暂存的真实 Git 候选, 没有注入点, 新测试与同文件其他 `prepare` 测试一样用 `stagedRepository` 建临时仓库并运行真实 Git (回调实测 43 毫秒). 按 spec-readiness Skill, 已开始实施后的措辞与一致性问题不修改 subject, 在此记录; 验收含义不变.
- 台账: .scratch/0060-commit-audit-round-number/issues/01-commit-audit-round-number.md:11 "预期验证" 中 "不新增真实进程或 Git 运行" 一句 记录不修 第 3 轮的措辞一致性问题; 实际做法与理由见上条第 2 轮处置, 验收含义不变, 不改 subject.
