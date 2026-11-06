# 停用兼容维护端口

Status: completed

## What to build

本 effort 只含本 issue, 不创建 spec: 它撤销 effort 0102 引入的兼容维护端口, 不含新的设计决定. 用户已事先确认这类无设计决定的 issue 不需要治理设计 (2026-11-02), 就绪审核通过例外流程记录 `not-applicable`. 停用时机由用户在 2026-11-07 决定 ("ARW 的旧端口停用, 能尽快上线吗", 随 0.5.3 发布), 即 0102 spec 所说的 "需另行决定".

升级路径核实 (实施前, 以代码和最小实测为据):

- `node install.mjs` 是新版本代码. 它在写入载荷前经 `acquireBackgroundAgentMaintenance` (`lib/installation/installation.mjs` 的维护步骤) 绑定新维护端口, 再经控制端口 (30000-49999, 公式未变) 向正在运行的旧管理进程发送 `__maintenance`, 旧管理进程返回 `managerPid` 并退出, 安装器核对其退出后才继续. 因此 0.5.2 到 0.5.3 的安装在新版本任何管理进程可能启动之前, 先停掉了旧管理进程. 实测: 用 0.5.2 的 `daemon.mjs` 起管理进程, 新版 `acquireBackgroundAgentMaintenance` 取得 `acquired`. 旧管理进程在启动完成后不再持有旧维护端口 (启动 lease 在监听就绪时释放), 所以此前也不靠旧端口与安装器互斥.
- 旧客户端遇到新 daemon: 控制端口公式, 协议和鉴权在 0.5.2 到当前之间未变 (`git diff 0.5.2 HEAD -- lib/background-agent` 只有维护端口与空行跳过). 实测: 0.5.2 的 `sendBackgroundAgentRequest` 对新 daemon 的 `list_agents` 请求得到 `ok: true`.
- 剩余窗口: 安装持有新维护端口期间, 此前版本的客户端若恰好冷启动管理进程, 只绑旧端口, 不被安装器排除. 两个管理进程仍不能并存 (控制端口 `exclusive` 绑定), 最坏结果是安装后残留一个旧代码管理进程, 新客户端按已有的 "管理进程运行不兼容代码" 提示 (`lib/background-agent/presentation.mjs`) 要求重新安装. 需要升级时恰有此前版本客户端冷启动, 概率很低, 后果可恢复, 不加代码.

改动:

- `lib/background-agent/client.mjs` 与 `daemon.mjs`: `backgroundAgentMaintenancePorts()` 复原为返回 `20000 + h % 10000` 的 `backgroundAgentMaintenancePort()`, 启动 lease, 维护互斥, 客户端和 daemon 的端口参数复原为单个 `maintenancePort`, 删除兼容端口的绑定, `EACCES` 跳过与释放逻辑, 以及客户端对它的探测.
- 测试: 撤销 0102 对 `daemon.test.mjs`, `client.test.mjs`, `process-identity.test.mjs` 中端口相关部分的改动 (两个兼容端口测试删除), 保留空行跳过的测试; 新增一个断言维护端口在 20000-29999.
- 长期规范: 安装规格 Background Agent management 节与维护互斥段落删去兼容维护端口, 写明升级时安装器先经控制端口停止此前版本的管理进程; Agent Repository Workflow 规格的启动失败规则只探测维护端口. effort 0102 的记录是历史记录, 不改.

体积预算: 非测试代码净减 (估约 -10 行), 测试净减, 文档净减.

预期验证: `tests/background-agent` 定向运行, `pnpm typecheck`, `pnpm test`, `node arw.mjs text check`, `node arw.mjs terms check`, `git diff --check`. 边界: 维护端口值仍在 20000-29999, 其他行为不变.

## Acceptance criteria

- [x] 启动 lease 与维护互斥只绑定一个维护端口 (`20000 + h % 10000`), 客户端只探测该端口; 代码中不再有兼容维护端口.
- [x] 测试断言维护端口值在 20000-29999; 兼容端口测试已删除, 空行跳过测试保留.
- [x] 两份长期规格不再提及兼容维护端口, 并写明升级时安装器先停止此前版本的管理进程.
- [x] 升级路径核实结论 (安装器先停旧管理进程, 旧客户端可用新 daemon, 剩余窗口可恢复) 记入 `## Validation`.
- [x] 完整 Source Checkout 验证通过, 完成记录含体积分类.

## Blocked by

- None - can start immediately

## Validation

- 升级路径核实: 临时脚本 (已删除) 用 0.5.2 的 `lib/background-agent/daemon.mjs` 起管理进程, 确认旧端口 55235 在启动完成后无人监听; 新版 `acquireBackgroundAgentMaintenance` 对它返回 `acquired`; 0.5.2 的 `sendBackgroundAgentRequest` 对新 daemon 的 `list_agents` 得到 `ok: true`.
- 结论 1, 安装器先停旧管理进程: 依据 `lib/installation/installation.mjs` 在写入载荷前调用 `acquireBackgroundAgentMaintenance`, 该函数经控制端口发 `__maintenance` 并核对旧管理进程 (0.5.2 的 `daemon.mjs` 返回 `managerPid`) 退出; 实测见上, 新版维护对 0.5.2 管理进程返回 `acquired`.
- 结论 2, 旧客户端可用新 daemon: 上述实测 0.5.2 客户端得到 `ok: true`; `git diff 0.5.2 HEAD -- lib/background-agent` 只含维护端口与空行跳过.
- 结论 3, 剩余窗口可恢复: 安装持有新维护端口期间此前版本客户端冷启动管理进程不被排除, 但控制端口 `exclusive` 绑定使两个管理进程不能并存, 最坏是残留旧代码管理进程, 新客户端按 `lib/background-agent/presentation.mjs` 的不兼容提示要求重新安装 (分析, 未实测).
- `pnpm typecheck` 通过; `pnpm test` 934/934 通过.
- `check-workflow-distribution`, `project-claude-skills --check`, `generate-install-arw --check`, `arw text check`, `arw terms check --include .scratch/0104-...`, `git diff --check`, `node --check` 受影响文件: 通过.
- 体积: 非测试代码净减 11 行 (`client.mjs` +18/-29, `daemon.mjs` 3/3 原位), 测试净减 29 行, 文档净减 380 字符, 文档字符净减.

## Comments

第 1 轮提交审核: Code Standards 指出启动 lease 返回的 `port` 字段无调用方读取, `released` 标记可由缓存 Promise 表达; 要求符合审核指出 `Validation` 缺三项结论, 以及 spec 中 "已不受支持" 超出授权. 均已修复 (删 `port` 字段与标记, 补结论, 删该措辞).

第 2 轮提交审核: 要求符合审核指出删去 `port` 字段超出 "复原".

台账: lib/background-agent/client.mjs:309-317 `acquireBackgroundAgentStartupLease` 不返回 `port` 字段 冲突裁决 Code Standards 第 1 轮以无调用方读取为由要求删除, 要求符合审核第 2 轮要求恢复; 该字段只在端口传 0 时与请求值不同, 生产调用不传 0, 测试用自己的辅助函数取端口, 按效率原则第 3 条与 `AGENTS.md` 先删后加保留删除, 不改回.
