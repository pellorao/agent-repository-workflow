# `launch()` 探测文件名加随机后缀, 修复同进程并发启动互相删除

Status: completed

## What to build

背景: issue 48 提交审核第 1 轮发现的真实缺陷 (当时单独重跑后通过, 记入 48 的 Comments). `lib/background-agent/client.mjs` 的 `launch()` 在管理进程未运行时先写再删 `.launch-probe-<pid>` 探测文件, 以判断调用方是否处于只读沙盒; 文件名只含 `process.pid`. 同一进程内两个并发请求 (如 `cat *.jsonl | arw background-agent --wait` 同时发送两个 Reviewer 请求) 各自进入 `launch()`, 先后 `writeFile` 同一路径, 再先后 `unlink`: 后一个 `unlink` 得到 `ENOENT`, 该请求以 `background-agent-operation-failed` 失败. 只在管理进程尚未运行时才会触发.

修复: 探测文件名的 `process.pid` 换成 `randomUUID()` (`node:crypto`, `client.mjs` 已从该模块导入其他函数), 每次调用各用各的文件. 备选 "多个调用共享一个进行中的 `launch` promise" 需要新增状态与清理, 更长, 不采用. 探测文件在 `writeFile` 之后立即 `unlink`, 不留文件; 进程在两步之间崩溃时会残留一个孤立的空文件, 此前同样残留, 本修复不改变也不处理它. 不改变任何公开 Interface, 持久状态格式和外部可见行为 (探测文件是内部临时文件, 仓库内没有其他代码读取其名称: `grep -rn "launch-probe" lib tests scripts docs` 只有 `client.mjs` 一处).

测试: 在 `tests/background-agent/client.test.mjs` 增加一个用例. 用不存在的 `entryPoint` 路径字符串和短 `messageTimeoutMs` 创建客户端, 运行目录没有 `credential` 文件, 使两个并发 `execute` 都走入 `launch()`; 断言两者的拒绝原因都是预算超时或管理进程未启动, 而不是探测文件的 `ENOENT`. 修复前该用例失败. 测试会以 `/unused-entry.mjs` 为入口派生一个立即退出的 `node` 子进程 (与既有沙盒用例相同的字符串入口; 字符串入口的 `launch` 只能经 `spawn`, 无法完全模拟), 它不监听任何端口, 不留驻留进程.

不做:

- 不处理崩溃残留的孤立探测文件: 此前同样存在, 无现实后果 (空文件, 位于用户私有运行目录).
- 不把全仓库约 25 处内联 `error instanceof Error && 'code' in error && error.code === ...` 判断公共化为 `lib/common` 的共享 `errorCode`. 开发规格只限制 `lib/common` 内的依赖方向 (`lib/common` 只依赖 `lib/common`; `tests/source-layout.test.mjs` 检查), 因此允许新增这样的小文件; 但经核对净行数为正: 新文件约 3 行, `release-manifest.json` 登记 1 行, 约 12 个使用文件各多一行 `import`, `client.mjs` 的本地定义去掉约 2 行, 而被替换的判断都是单行, 替换不减少行数, 只缩短每行字符数, 净增约 +14 行. 另有 `reviewer-runtime.mjs` 的字符串类型判断与 `process-identity.mjs` 的 `code===1` 等语义不同的写法不能直接替换, 文件还分散在 8 个责任目录, 为约 700 个字符的缩短增加跨模块耦合与改动面, 按 `AGENTS.md` 的 `Efficiency First` 第 1, 2 条不做. 48 的提交审核提出过同一建议并已记入待办候选; 本 issue 的结论是不值得做.

预估净增 (代码 / 测试 / 文档): 代码 0 (改一行), 测试约 +12, 总约 +12 行 (实际可能为 +8 至 +18).

## Spec Requirement

Governing requirements:

- `docs/specs/agent-repository-workflow/spec.md#background-agent-control`
- `docs/specs/agent-repository-workflow-development/spec.md#validation-strategy`

## Acceptance criteria

- [x] 同一进程内两个并发请求在管理进程未运行时互不干扰. 观察: `grep -n "launch-probe" lib/background-agent/client.mjs` 的文件名含 `randomUUID()` 且不含 `process.pid`; 新用例两个并发 `execute` 都以预算超时或 `did not start` 类错误拒绝, 没有 `ENOENT` (在修复前的代码上运行该用例会失败, 实施时先确认).
- [x] `client.mjs` 不增加状态, 不改变其他行为. 观察: `git diff -- lib` 只有探测文件名一行 (及必要时 `randomUUID` 的导入); `tests/background-agent/client.test.mjs` 与 `daemon.test.mjs` 既有用例通过.
- [x] 新用例不留驻留进程且不慢. 观察: 测试结束后 `pgrep -f unused-entry` 为空; 新用例回调耗时低于 100 毫秒阈值 (见 `test-performance-optimization` Skill 的测量).
- [x] `pnpm test`, `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `node arw.mjs text check`, `git diff --check` 通过.
- [x] 净增在估算的一倍以内. 观察: `git diff --numstat -- lib tests docs` 汇总.

## Blocked by

- None - can start immediately

## Validation

- Spec Readiness: 1 轮 haiku high, `No problems.`, `arw spec-readiness verify --issue issue:0001:49` 退出 `0`.
- 先写新用例并确认在旧代码上失败 (`ENOENT, unlink '.launch-probe-<pid>'`), 修复后通过; 把修复行临时改回 `process.pid` 再次运行, 用例仍失败 (`messageTimeoutMs:50` 下也能复现), 随后恢复. 修复后连续 5 次运行 `client.test.mjs` 均通过, 新用例约 51 毫秒 (低于 100 毫秒阈值).
- `pnpm test` 794 项, 793 通过 (1 项既有跳过), `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `node arw.mjs text check`, `git diff --check` 通过. 测试后 `pgrep -f unused-entry` 为空.
- 净增 (`git diff --numstat -- lib tests docs`): 代码 +2/-2 (导入与文件名各一行), 测试 +9, 净 +9 (估算 +12).

## Comments

- 本 issue 来自 48 提交审核第 1 轮的发现与 code-standards 的公共化建议; 后者经核对不做, 理由见 "不做".
