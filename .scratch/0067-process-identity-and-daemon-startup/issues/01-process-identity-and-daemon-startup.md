# Linux 进程身份不随墙钟变化, 管理进程启动失败即时报错

Status: completed

## What to build

按本 effort 的 `spec.md` 实现两部分, 它们共用同一份 spec, 所以放在一个 issue 中.

1. Linux 进程身份值 (`process-identity` 模块): 新记录的值由内核 `boot_id` 与进程 starttime 滴答数组成, 不再读取 `btime` 和 `getconf CLK_TCK`; 记录的值先按 spec 的校验规则判断 (十进制数或 `boot_id` 加冒号加十进制数, 其他为无效身份); 写入记录时使用同一校验. 观察进程的函数新增可选第二参数 `recorded`, Linux 上记录值是纯数字时按旧公式 (`btime` 秒数乘十亿加滴答数乘一千万) 重算当前值, 其他情况使用新形式; `readProcessIdentity` 把记录值传给读取器. 旧公式分支加注释写明它只服务于升级前留下的记录, 在引入本改动的发布版本之后的下一个发布版本中删除. Windows 与 macOS 的读取不变.
2. 管理进程启动失败即时报错 (`client` 模块): 启动子进程前在私有运行状态目录创建本次专用文件 `daemon-stderr-<随机后缀>` (仅当前用户可访问; 它取代现有的探测文件, 创建失败就是原来的探测失败, 结果相同), 子进程的标准错误指向其文件描述符, 标准输出仍丢弃; 监听子进程 `exit`. 无论启动成功, 失败还是超时, 结束时都删除该文件 (删除失败忽略); 只有失败时读取它. 每个轮询周期: 子进程已退出时先探测维护端口, 再探测控制端口; 维护端口可连接则继续等待; 否则控制端口仍被拒绝时立即报错, 文字以 `Background Agent manager exited during startup` 开头, 带退出码 (被信号结束时为信号名) 和该文件去掉首尾空白后的内容 (为空时写明没有输出). `createBackgroundAgentClient` 新增可选输入 `maintenancePort`, 默认等于已有的维护端口函数, 命令入口不传. 管理进程一侧不改.
3. 长期文档: 按 spec 的 "长期文档" 一节只在定义处更新: 安装规范 Background Agent management 节的身份值描述 (同时定义其他各处 "进程创建时间" 指该值) 和启动时的 `daemon-stderr-<后缀>` 文件, 主规范冷启动与预算处补启动失败规则 (一两句); spec 列出的其他提法和 ADR 不改写. 兼容路径不写入长期规范.

不改变命令输出 (除新增的启动失败文字), 公开 Interface, 身份文件的外形 (`<PID>,<值>`), 管理进程一侧代码和 Windows, macOS 行为.

预期验证: 身份读取器测试用假 `/proc` 内容 (替换文件读取并还原), 不依赖真实休眠; 记录读写测试用注入的读取器; 客户端测试按 spec 的 Testing Decisions, 唯一新增的真实进程测试是一个写标准错误并以非零退出的子进程. 现有使用不存在入口文件的客户端测试按新语义调整 (占用维护端口或观察新失败文字), 观察目标不变. 测试回调低于 100 毫秒.

体积预算: 非测试代码净增约 +25 行 (身份读取约 +4, 客户端启动约 +20).

## Acceptance criteria

- [x] Linux 新记录的值是 `boot_id` 加冒号加 starttime 滴答数; 同一假 `/proc` 输入读两次相同, `btime` 不同时结果不变, `boot_id` 不同时结果不同; 不运行 `getconf`; 由 `tests/background-agent/process-identity.test.mjs` 观察.
- [x] 记录值为纯数字的 Linux 旧记录: 旧公式重算值相同时 `readProcessIdentity` 判为存活, 不同时判为已结束; 新形式记录, 畸形值各得到存活或已结束, `unknown`; 写入新形式后文件内容为 `<PID>,<值>`; 由同一测试文件观察.
- [x] 子进程在控制端口可连接之前以非零退出且维护端口无人监听时, 客户端在预算用尽之前以 `Background Agent manager exited during startup` 开头, 含退出码和子进程写到标准错误的文字的错误失败, 运行状态目录里没有留下标准错误文件; 由 `tests/background-agent/client.test.mjs` 的真实子进程测试观察.
- [x] 同样的子进程退出但维护端口有人监听时客户端不失败, 控制端口随后可连接时请求成功送达, 结束后运行状态目录里没有标准错误文件; 由同一测试文件观察.
- [x] 子进程已退出而维护端口始终被占用时, 请求在预算用尽时以 `timed out before delivery` 失败, 运行状态目录里没有标准错误文件; 由同一测试文件观察 (取代现有并发冷启动超时测试的写法).
- [x] 现有使用不存在入口文件的客户端测试在新语义下仍通过, 观察目标不变 (含沙盒拒绝测试: 目录不可写时仍给出沙盒失败响应且不启动子进程).
- [x] 两处长期规范已按 spec 更新, `node arw.mjs text check`, `pnpm typecheck` 和 touched 测试文件通过.

## Blocked by

- None - can start immediately

## Validation

- `node --test --test-reporter=spec tests/background-agent/process-identity.test.mjs tests/background-agent/client.test.mjs`: 17 个测试通过. 新增或改写的测试回调耗时 (单次测量): 身份值 2.1 毫秒, 旧记录经 `readProcessIdentity` 1.9 毫秒, 记录形式 4.3 毫秒, 管理进程启动即退出 24 毫秒, 凭据在端口可连接后读取 44 毫秒, 都低于 100 毫秒阈值; 并发冷启动超时测试 403 毫秒 (预算 400 毫秒, 测试要观察预算用尽, 不改生产代码降不到阈值以下, 保留超时).
- 变异核对 (提交审核前): 把 "另一个管理进程正在启动" 判断固定为否 (`startupActive = false`) 后, 原并发冷启动超时测试和 "端口可连接后才读取凭据" 测试在三次运行中都失败; 还原后通过. 提交审核第 11 轮后超时测试改用写标准错误并以退出码 3 退出的入口, 预算 400 毫秒, 并断言维护端口收到过探测连接 (只有观察到子进程退出后才会探测), 由此证明退出已被观察.
- `node --test tests/background-agent/*.test.mjs`: 205 个测试通过; `pnpm test`: 884 个测试通过 (提交审核第 11 轮修复后重新运行); `pnpm typecheck`, `node arw.mjs text check`, `node arw.mjs terms check --include .scratch/0067-process-identity-and-daemon-startup/`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `git diff --check` 通过.
- 验收项对应: 身份值与旧记录见 `tests/background-agent/process-identity.test.mjs` 的 Linux 两个新测试 (旧记录测试用不注入读取器的 `readProcessIdentity` 观察存活与已结束) (假 `/proc` 内容, 含 `getconf` 假命令日志为空); 记录形式见同文件 "boot-id form" 测试; 启动失败即时报告, 另一个管理进程启动时的成功, 超时均不留标准错误文件见 `tests/background-agent/client.test.mjs` 的三个对应测试; 沙盒拒绝测试仍通过.
- `git diff --cached --numstat HEAD -- lib`: `client.mjs` 34/17, `process-identity.mjs` 23/13, `claude-sessions.mjs` 1/1 (类型注释), 非测试代码净增 +27 行 (预算约 +25; 多出的 2 行是审核后加入的退出快照注释和 `CreationTimeReader` 类型定义, 后者替代了四处手写签名). `commit-audit prepare` 第 12 轮实测: 代码 +27 行 (3 个文件), 文档 +552 字符 (2 个文件).
- 就绪审核: 5 轮 (前 4 轮的发现依次是 ADR 评估与降级限制, 长期文档一致性范围, 跨进程并发改为每次启动独立文件, 文件创建失败与删除结果的观察依据, 孤儿文件描述与测试, 第 5 轮 `No problems.`), 记录 `01.spec-readiness.json`.

## Comments

- 偏离 spec 之处: 无. 实现把 `daemon-stderr-<后缀>` 文件同时作为原有的目录可写探测 (spec 的 "取代探测文件"), 所以删除了探测文件和 `writeFile` 导入.
- 兼容路径的删除条件写在 `process-identity.mjs` 的注释中: 引入本改动的发布版本之后的下一个发布版本删除旧公式分支和 `recorded` 参数.
- 未在本机真实复现 WSL2 休眠恢复; 墙钟步进由 "`btime` 变化而结果不变" 的假 `/proc` 测试代表.
- 管理进程运行安装目录中的代码, 身份文件新形式在 `node install.mjs` 更新管理进程后才开始写入; 客户端的启动失败报告下一次调用即生效.
- 提交审核第 11 轮的处置: 退出状态每个轮询周期取一次快照, 租约探测与失败判断共用它 (退出在探测之后才被看到时留给下一周期); 并发冷启动超时测试改为真实退出的子进程并断言租约被探测; 旧记录测试改经 `readProcessIdentity`; 读取器签名收为一个 `CreationTimeReader` 类型; spec 的四个 H3 改英文, 旧记录示例值与公式一致; 本节数字与已暂存树核对一致.
- 体积超出: 非测试代码净增 +27 行, 超出预算 (约 +25) 2 行. 来源是提交审核第 11 轮的两处修复: `client.mjs` 的退出快照 (修正租约探测与退出判断之间的竞争, 行为缺陷) 和 `process-identity.mjs` 的 `CreationTimeReader` 类型定义 (替代四处手写签名); 二者都不能再删而不丢失修复.
