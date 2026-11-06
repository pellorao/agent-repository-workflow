# 机器入口跳过空行, 维护端口移出动态端口段

Status: completed

## What to build

按本 effort spec 修复两项已复现的缺陷, 并同步修改相应长期规范.

- 机器入口: 只含空格, 制表符或回车的行 (含空字符串和输入末尾无换行的剩余内容) 在解析前跳过, 不产生响应, 不占用请求 `id`; 其他无法解析或不支持的请求仍按现有合同返回错误, 包括 `id: null` 的 `background-agent-request-invalid`.
- 维护端口改为 `20000 + h % 10000`, 原 `50000 + h % 10000` 作为兼容维护端口. 启动 lease 与维护互斥的每个持有者先绑定维护端口, 再绑定兼容维护端口; 维护端口的绑定错误原样抛出且不再绑定兼容维护端口, 兼容维护端口的 `EACCES` 以外的错误 (含 `EADDRINUSE`) 先释放维护端口再原样抛出, `EACCES` 时跳过它只持有维护端口; 维护互斥照旧把 `EADDRINUSE` 返回为 busy, 其他错误返回 `unknown`. 客户端判断另一管理进程正在启动时, 任一维护端口可连接即继续等待. 控制端口不变.
- 端口参数改为有序数组 (维护端口在先), 启动 lease 结果去掉无人使用的端口字段.
- 长期规范: Agent Repository Workflow 长期规格的 Machine entry 节写入空行规则, 后台管理进程启动规则写入任一维护端口可连接; 安装长期规格的 Background Agent management 节写明三个端口的关系与维护端口范围的理由, Uninstallation 节的互斥段落写明绑定顺序, `EACCES` 跳过规则, 跨版本互斥理由, 以及停止绑定兼容维护端口会重新打开与此前版本混用时的互斥缺口, 删除需另行决定, 其余 "绑定固定维护端口" 的写法改为 "取得维护互斥".

体积预算: 非测试代码净增约 +12 行; 长期规范净增约 +1500 字符; 测试约 +50 行.

预期验证: 机器入口进程内测试 (空行混入无效与合法请求); 真实回环端口上的维护互斥测试 (只占兼容维护端口时 busy 且维护端口已释放, 新版本持有时单独绑定兼容维护端口失败, 兼容维护端口 `EACCES` 时跳过, 当前环境不报 `EACCES` 时该例跳过; 无效端口号使两个端口各自的其他绑定错误原样拒绝并释放已绑定端口); 客户端启动探测测试 (只有兼容维护端口在监听时继续等待); 端口值范围断言; 完整 Source Checkout 验证.

## Acceptance criteria

- [x] 空行 (空字符串, 只含回车, 只含空格和制表符, 末尾无换行) 不产生响应, 只含不换行空格的行和其他非空的无效请求仍各返回一条错误, 合法请求的执行与响应不变, 由机器入口进程内测试观察响应行证明.
- [x] 维护端口在 20000-29999, 兼容维护端口为其加 30000; 维护互斥对只持有兼容维护端口的一方返回 busy 并释放维护端口, 持有互斥时兼容维护端口不可再绑定, 兼容维护端口 `EACCES` 时仍取得互斥, 两个端口的其他绑定错误原样拒绝且不遗留已绑定端口, 由测试证明.
- [x] 客户端在只有兼容维护端口可连接时不把管理进程退出报告为启动失败, 由客户端启动探测测试观察证明.
- [x] 两份长期规范按 What to build 更新, 与实现一致, 由 `git diff -- docs/specs` 逐项核对.
- [x] 完整 Source Checkout 验证通过: `pnpm typecheck`, `pnpm test`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, 受影响 JavaScript 的 `node --check`, `node arw.mjs text check`, `node arw.mjs terms check --include .scratch/0102-machine-blank-lines-and-maintenance-port/`, `git diff --check`.

## Blocked by

- None - can start immediately

## Validation

- `node arw.mjs spec-readiness verify --issue issue:0102:01`: 退出码 0, 第 2 轮就绪审核结果 `satisfied` (第 1 轮 5 个 gap 的处理见 Comments).
- 机器入口: `tests/background-agent/machine.test.mjs` 的无效请求测试在输入前后加入空字符串行, 只含回车, 只含空格和制表符的行以及末尾无换行的空白, 另加一行只含不换行空格; 观察响应仍为 15 条 (空行不产生响应), 只含不换行空格的行得到一条 `id: null` 错误, 执行的操作不变. 改动前的代码对这些输入多产生 `id: null` 错误, 该测试失败.
- 维护互斥: `tests/background-agent/daemon.test.mjs` 新增两个真实回环端口测试. 第一个观察: 维护端口在 20000-29999 且兼容维护端口为其加 30000; 只有兼容维护端口被占用时维护流程返回 busy; 65536 作兼容维护端口或维护端口时启动 lease 以 `ERR_SOCKET_BAD_PORT` 拒绝; 之后两个端口都能重新取得 (没有遗留占用); 新版本持有时单独绑定兼容维护端口得到 `EADDRINUSE`. 第二个以端口 1 作兼容维护端口, 本机 (非 root Linux) 实测 `EACCES`, 启动 lease 照常取得, 维护端口被占用. 只绑定第一个端口的退化实现使第一个测试失败, 进程挂住 (lease 不释放).
- 客户端探测: `tests/background-agent/client.test.mjs` 的并发冷启动测试改为维护端口关闭, 只有兼容维护端口在监听, 观察客户端继续等待到预算用尽 (`timed out before delivery`), 不报启动失败.
- 长期规范: `git diff -- docs/specs` 逐项核对. 机器入口合同写入空行规则, 管理进程启动规则写入任一维护端口; 安装规格写入端口关系与范围理由, 互斥段落写入绑定顺序, `EACCES` 跳过, 跨版本理由和删除须另行决定; 其余 4 处 "绑定固定维护端口" 改为 "取得维护互斥".
- `pnpm typecheck`: 通过. `pnpm test`: 934/934 通过, 0 跳过, 约 3 秒.
- `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`: 通过.
- `node --check` 检查 `lib/background-agent/client.mjs`, `lib/background-agent/daemon.mjs`, `lib/background-agent/machine.mjs` 以及 4 个改动的测试文件: 通过.
- `node arw.mjs text check`, `node arw.mjs terms check --include .scratch/0102-machine-blank-lines-and-maintenance-port/`, `git diff --check`: 通过. 语言比例: spec Chinese 94.8%, issue Chinese 87.8%.
- 体积 (Commit Audit 摘要): code: +10 lines (files: 3), 预算 +12; documents: +1018 characters (files: 2), 预算约 +1500; tests: +35 lines (files: 4), 估计约 +50.
- 测试耗时: 新增和修改的用例都在 10 毫秒以内. 并发冷启动用例约 402 毫秒, 由其 400 毫秒消息预算决定, 改动前相同, 按本仓库 Baseline 例外保留.

## Comments

Main Agent 指派本 effort (任务 `ARW/f15design`): F1 与 F5 均已复现, 由 Opus high 的独立 Agent 分析 spec 合同与版本过渡并写入 spec, 按 ARW 自主工作方式与 Source Checkout Baseline 例外, Main Agent 分配的改动内容即为长期规范改动的确认. 复现: 机器入口对空行, 只含回车和只含空白的行各返回一条 `id: null` 错误; Windows 排除范围在两次检查中位于动态端口段的不同位置, 原维护端口范围内的端口监听得到 `EACCES`.

就绪审核第 1 轮 (Reviewer 结果 ready, 5 个 gap) 按 Reviewer-proposed changes 节, 由本 Agent 与一个独立 subagent (Opus high) 分别判断, 双方一致认为 5 条都应收窄修正, 不改设计方向: 删除条件改为 "停止绑定会重新打开互斥缺口, 删除须另行决定"; 补两个端口其他绑定错误的测试观察; 补 Windows `EACCES` 由同一错误码分支覆盖的理由; 补不换行空格的错误观察; 为三项 Module 边界补接受的成本. subagent 另指出 spec 误写维护互斥对其他错误 "原样抛出", 实际按原规则返回 `unknown`, 已一并改正. 第 2 轮 `No problems.`.

只删减与合并的自查: 启动 lease 去掉 try/catch 和 `released` 标志 (对已关闭的 server 再次 `close` 仍会调用回调, 所以释放可重复), 非测试代码净增从 +19 行降到 +9 行 (Commit Audit 第 1 轮改名加注释后为 +10 行), 低于 +12 行预算. 精简时一度漏掉 `listen` 对无效参数的同步抛出, 新测试因此挂住而发现, 已用 `.catch` 收回.

未经验证的推断: spec 中 "Windows 不会在已被占用的端口上新增排除范围" 未在本机实测; 它只影响 "旧版本已持有兼容维护端口后, 该端口才被划入排除范围" 这一极少见的情形.

Commit Audit 第 1 轮: 要求符合审核 `No problems.`; Code Standards 2 条. 绑定结果的命名 (`resolveListen`, `error`, `invalid`) 已改为表达绑定结果的名称并加注释.
台账: `lib/background-agent/client.mjs` 启动 lease 中 `listen` Promise 的 `.catch(thrown=>thrown)` 冲突裁决 本 effort spec 的 Testing Decisions 与本 issue 验收项要求以无效端口 65536 观察两个端口的其他绑定错误原样拒绝且释放已绑定端口, 去掉它会使维护端口遗留占用 (该用例挂住), 改测试设计需改 subject 并重跑就绪审核.
台账: `lib/background-agent/client.mjs` 的 `maintenancePorts` 有序数组参数 (维护端口在先) 冲突裁决 本 effort spec 的 Interfaces 与 Module Design Rationale 选定有序数组并记录了 "数组位置带有含义" 的代价; 生产调用方都使用默认值, 改为具名对象属于 spec 接口变更.
