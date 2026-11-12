# 判断模型与兼容端点的安装与配置: 事实核对

## Scope

本报告为 [确定判断模型与兼容端点的安装与配置](../../issues/20-decide-installation-and-configuration.md) 收集决定所需的事实, 核对日期 2026-11-13. 范围: 配置时的硬件探测, 推理运行时与模型文件的来源和版本固定, 开启脚本的依赖, 同机显卡占用者的让出, Engine 与判断模型在 Windows 与 WSL 之间的网络和防火墙前提, Claude Code 与 Codex 的版本漂移. 资料分三类: 一手来源 (官方文档, 源码 README, 第一方 API, 表中 [Sn]), 维护者本机实测 (私有任务记录, 未入库, 表中 [Ln]), 推断 (标明). 没有在本机开非回环监听, 没有改防火墙, 没有启动判断模型或使用 GPU 计算, 没有下载模型或运行时; 只做了只读查询 (`nvidia-smi` 查询, GitHub 与 Hugging Face 的元数据 API, npm registry 元数据). 运行时候选的能力, 价格与榜单见 [Jev 类判别模型调研报告](../jev-class-models/report.md) 与 [Jev 类模型接入方式的事实核对](../judge-model-integration/report.md), 两个 harness 接本地与第三方模型的路径见 [Claude Code 与 Codex 接入本地和第三方模型的路径](../agent-platform-models/report.md), 本报告不重复.

## Questions

1. 配置时用什么探测显卡与显存, 能否看出谁在占用显卡.
2. 推理运行时 (以 llama.cpp `llama-server` 为主) 与模型文件怎样按精确版本取得和校验.
3. 运行时自身提供哪些与开启脚本相关的能力 (就绪检查, 绑定地址, 认证, 显存自适应, 空闲释放).
4. 维护者本机部署的判断模型怎样安装, 开启, 被 WSL 访问, 遇到了什么防火墙问题.
5. Strata 这类同机显卡占用者有没有可供调用方让出显卡的接口.
6. Engine 在登录时自启, 以及 Engine 位于 WSL 时局域网入口的前提.
7. Claude Code 与 Codex 的发布节奏, 自动更新与版本固定手段.

## Key findings

1. 事实: `nvidia-smi --query-gpu=... --format=csv` 在 Windows 与 Linux 上都可用 [S1]; 在 WSL 中经 Windows 驱动提供的库可用 [S3, L5]. 但 Windows WDDM 模式下按进程的显存占用 "Not available" [S1], 本机 Windows 侧查询每个进程的显存都是 `[N/A]`, WSL 侧连进程列表都看不到 [L5]. 所以只能可靠测到整卡已用与总量, 不能按进程归因; 让出显卡只能针对事先登记的占用者.
2. 事实: llama.cpp 每个构建号一个 GitHub 发布 (标记为预发布, 一天多个), 每个平台 (Windows 与 Ubuntu 的 CUDA 12.x 与 13.x, Vulkan, ROCm, CPU, macOS) 有独立资产 [S4]; GitHub 自 2025-06 起为发布资产自动计算 SHA-256 并在 REST API 的 `digest` 字段返回 [S5]. 构建号加资产名加 `digest` 即可固定运行时.
3. 事实: Hugging Face 模型仓库可以按完整提交哈希下载文件 [S6]; 模型 API (`?blobs=true`) 返回仓库提交和每个 LFS 文件的 SHA-256 与大小, 对 `resolve` 地址的 HEAD 响应也带 `x-repo-commit` 与 `x-linked-etag` (即 SHA-256) [S7]. 仓库提交加文件名加 SHA-256 即可固定模型文件.
4. 事实: `llama-server` 默认只监听 `127.0.0.1` [S2]; `/health` 在加载中返回 503, 就绪返回 200, 且不需要 API key [S2]; `--api-key` 或 `--api-key-file` 可开启认证 [S2]; `--fit` 默认开启, 自动调整未设定的参数以装进设备显存 [S2]; `--list-devices` 列出可用设备 [S2]; `--sleep-idle-seconds` 默认关闭, 文档只说空闲后卸载模型和 KV 缓存 "from RAM", 没说显存 [S2]; `/v1/systemone` 对非判断模型返回 501 [S2].
5. 维护者本机 [L1, L2]: GLiDE-9B Q8_0 由 llama.cpp b12317 Windows CUDA 13.5 构建运行, 装在 Windows 用户程序目录下, 分 `bin` (开启脚本), `runtime`, `data/models`, `logs`, `downloads`; 开启脚本参数集中在顶部, 默认只绑 `127.0.0.1`, 启动前检查 `strata` 进程在运行就拒绝启动. 显存增量 9.0 GB, 加载到 `/health` 约 3.6 s (文件在系统缓存中), 单题 p50 47 到 74 ms. 依赖只有运行时两个压缩包 (程序与 CUDA 运行库, 共约 604 MB) 和模型文件, 不需要 Python.
6. 维护者本机 [L2, L3, L4]: 首次绑到 WSL 虚拟网卡的主机侧地址时, Windows 防火墙弹出提示无人应答, 自动生成两条入站 Block 规则, 压过已有的同端口放行规则, WSL 访问超时. 管理员删除这两条并加一条只放行该程序, 该端口, 本地子网的规则后正常. 该地址每次重启可能变化, 开启脚本改为运行时读取网卡地址; WSL 侧按默认网关地址访问. 官方文档与此一致: 无人应答或非管理员时生成 Block 规则, 显式 Block 压过 Allow [S8].
7. 事实: WSL2 默认 NAT 下局域网设备不能直接连 WSL 中的服务, 要 portproxy (管理员, 目标地址随重启变化) 或 mirrored 网络模式 (管理员, 全局, 要重启 WSL) [S9, S10]; 发行版空闲 15 s 后关闭 (`instanceIdleTimeout`), 可设为 -1 关闭自动关闭 [S10].
8. 事实: Strata 前端 (维护者本机, 私有仓库) 有现成的让出接口: `POST /lease/acquire` 被占时立即返回 409, 不排队不抢占; 持有 lease 时 `POST /model/stop` 停模型而保留 lease; 无 lease 的模型空闲 30 分钟后才停止 [L6]. ARW 现有 Strata 驱动已实现 lease 获取, 停止, 释放与异常退出后释放 (见 Jev 类模型接入方式的事实核对).
9. 事实: Claude Code 原生安装默认在后台自动更新, 下次启动生效; 可按版本号安装, 可选 `stable` 通道 (约晚一周, 跳过有重大回归的版本), `DISABLE_AUTOUPDATER` 只停后台检查, `DISABLE_UPDATES` 封住全部更新路径; 托管设置 `requiredMinimumVersion` 与 `requiredMaximumVersion` 可让 Claude Code 在版本范围外拒绝启动; 原生安装只保留启动器所指, 正在运行的和最新两个版本 [S11]. 11-13 的 npm 标签: `stable` 2.1.311, `latest` 2.1.322 [S13].
10. 事实: Codex 有 `check_for_update_on_startup` 开关, 自定义提供方的 `wire_api` 只支持 `responses` [S12]; npm 包按精确版本发布, 11-13 `latest` 为 0.167.2, alpha 为 0.170.0-alpha.3; GitHub 发布标签形如 `rust-v0.167.2` [S13, S14]. 两个 harness 都是一两天一个版本.

## 1. Hardware probing

| 项 | 事实 | 来源 |
| --- | --- | --- |
| 显卡与显存 | `--query-gpu` 按逗号列出属性, `--format=csv,noheader,nounits`; FB Memory 有 Total, Used, Free | S1 |
| 平台 | nvidia-smi 支持 Linux 与 64 位 Windows | S1 |
| 按进程显存 | "Not available on Windows when running in WDDM mode because Windows KMD manages all the memory not NVIDIA driver." | S1 |
| 本机实测 | WSL 中 `nvidia-smi --query-gpu=name,memory.total,memory.used,driver_version` 正常返回; `--query-compute-apps` 在 WSL 中为空; Windows 侧列出桌面进程, 显存一律 `[N/A]`, 驱动模式 `WDDM` | L5 |
| WSL GPU | `[gpu] enabled` 默认 true, 经半虚拟化访问 Windows GPU, `/usr/lib/wsl/lib` 加入 PATH | S10 |
| 运行时自探测 | `llama-server --list-devices` 列出设备; `-dev` 选设备; `--fit` (默认 on) 自动让未设定的参数装进显存, `--fit-target` 每设备余量默认 1024 MiB, `--fit-ctx` 最小上下文默认 4096 | S2 |

推断: 非 NVIDIA 显卡没有统一的查询命令; 用所选运行时的 `--list-devices` 作为最终探测最省事, 但要先知道下载哪个构建 (CUDA, Vulkan, ROCm, Metal). 可行的顺序是先看 `nvidia-smi` 是否存在决定构建, 再用该构建的 `--list-devices` 核对.

## 2. Pinning the runtime and the model file

运行时 (llama.cpp):

- 发布形态: 每个构建号 (如 `b12328`) 一个 GitHub 发布, 均标记为预发布; 11-12 一天内有 b12323, b12327, b12328 [S4].
- 资产: Windows 有 `llama-<b>-bin-win-cuda-12.4-x64.zip`, `...-win-cuda-13.5-x64.zip`, `...-win-vulkan-x64.zip`, `...-win-cpu-x64.zip` 等, CUDA 构建另需 `cudart-llama-bin-win-cuda-<v>-x64.zip`; Ubuntu 有对应的 `.tar.gz` 与 `cudart-...`; 另有 macOS, ROCm, SYCL, OpenVINO 构建 [S4]. 各资产 `digest` 字段为 `sha256:<hex>` [S4, S5].
- 本机: Windows CUDA 13.5 构建在 CUDA 用户态驱动 13.4 上可用, 不必换 12.4 构建 [L1].

模型文件 (Hugging Face):

- `hf_hub_download(..., revision=<完整提交哈希>)` 按提交下载, 提交哈希必须是完整长度 [S6]; `hf download` 也接受 `@<revision>` [S6].
- 本机所用仓库 `bartowski/fastino_GLiDE-9B-GGUF` 11-13 的仓库提交 `88e7a44e…92359`; `fastino_GLiDE-9B-Q8_0.gguf` 9,545,985,728 B, SHA-256 `da655954…bb3df`, 与 HEAD 响应的 `x-linked-etag` 一致 [S7].
- `llama-server -hf <repo>[:quant]` 能直接下载并缓存, `--offline` 只用缓存 [S2]; README 未说明缓存位置和按提交固定, 所以固定版本时不依赖 `-hf`, 而是按提交地址下载后自行校验 SHA-256 (推断).
- 许可: GLiDE-9B 为 fastino-community 许可, 年收入超过 1000 万美元的实体用于生产商业用途须另签协议 [L7 引 Hugging Face 模型卡]. 推断: ARW 只提供下载地址与校验值, 不再分发文件, 但配置时要向用户显示许可.

## 3. Runtime features relevant to the start script

| 项 | 事实 | 来源 |
| --- | --- | --- |
| 绑定 | `--host` 默认 `127.0.0.1`, 可为逗号分隔地址或 `.sock` 路径; 默认端口 9931 | S2 |
| 就绪 | `/health` 公开, 不查 API key; 加载中 503 `Loading model`, 就绪 200 `{"status": "ok"}` | S2 |
| 认证与 TLS | `--api-key`, `--api-key-file`; `--ssl-key-file`, `--ssl-cert-file` 需要以 OpenSSL 构建 | S2 |
| 空闲 | `--sleep-idle-seconds` 默认 -1 (关闭); 休眠时卸载模型与 KV 缓存 "from RAM"; `/health` 不触发重载也不重置空闲计时 | S2 |
| 判断接口 | `/v1/systemone` 题型 `choice`, `score`, `noul`; 非判断模型返回 501; 输出 token 恒为 0 | S2 |
| 路由模式 | `--models-dir`, `/models/load`, `/models/unload`, `--models-memory-margin` (按 LRU 卸载以腾显存) | S2 |
| 本机实测 | GLiDE 日志标明为判断模型, 无 prompt cache; 17k token 的 state 超过 16384 上下文时仍返回, 是否截断未验证 | L1 |

## 4. Maintainer's local deployment

本节全部来自维护者本机任务记录 [L1 到 L4], 机器相关的路径和地址已改为占位符.

- 布局: `%LOCALAPPDATA%\Programs\glide-9b\` 下 `bin\` (开启脚本与测量脚本), `runtime\llama.cpp\`, `data\models\` (两种量化共约 17.3 GB, 由用户在另一台机器多线程下载后传入), `logs\`, `downloads\` (保留的运行时压缩包, 供重装). 用户要求放在 Windows 侧用 Windows 程序运行, 不放进 WSL.
- 开启脚本 (PowerShell 7): 顶部变量为量化, 绑定地址, 端口, 上下文 16384, `-ngl all`, 并行 1, 别名; 参数 `--no-kv-unified --no-warmup`; 默认只绑 `127.0.0.1`; `-Wsl` 开关在运行时读取名为 `vEthernet (WSL*` 的网卡地址后绑定; 发现 `strata` 进程即报错退出; 输出同时写日志.
- 端口: 起初选 8000 是为了沿用 Strata 前端已有的放行规则, 结果与 Strata 前端同端口, 只能在 Strata 前端不占该端口时运行.
- 防火墙: 见 Key findings 6. 用户执行的放行规则只放行该程序路径, TCP 该端口, 远端 `LocalSubnet`, 全部配置文件.
- WSL 访问: WSL 中程序取默认网关地址 (即 Windows 侧虚拟网卡地址) 加端口访问, `/health` 与 `/v1/systemone` 都通.
- 实测性能: 见 Key findings 5; Q6_K 显存 7.6 GB, 延迟与 Q8_0 无差别.
- 下载与写盘: 运行时约 604 MB (单连接 10 到 100 KB/s, 改 24 路并行分块才完成), 解压约 787 MB.

## 5. Yielding the GPU

- Strata 前端 [L6]: lease 只在内存中, 前端重启即强制回收; lease 本身没有超时; 归还 lease 不停模型, 无 lease 的模型空闲 30 分钟后停止, 期间约占 11 GB 显存; `/lease/acquire` 被占时立即 409; 持有 lease 时 `/model/stop` 停模型并保留 lease.
- ARW 现有 Strata 驱动 (`lib/background-agent/strata-driver.mjs`) 已实现 lease 获取, 模型启停, 释放, 以及管理进程异常退出后的 lease 在下次启动时释放 [见 Jev 类模型接入方式的事实核对].
- 本机的临时做法 [L1, L7]: 开启脚本在 `strata` 进程存在时拒绝启动; POC 期间由 Main Agent 先确认 lease 空闲, 再结束 Strata 的计划任务, 用完重新启动.
- 推断: 对没有控制接口的程序, Engine 无法安全判断能否停止 (按进程的显存不可见, 见第 1 节), 只能执行用户登记的让出与恢复命令.

## 6. Autostart and LAN entry prerequisites

| 项 | 事实 | 来源 |
| --- | --- | --- |
| Windows 登录启动 | `HKCU\...\CurrentVersion\Run` 每次该用户登录时运行, 命令行不超过 260 字符; 系统不保证多快执行, 可能延后 | S15 |
| Linux 登录与常驻 | `loginctl enable-linger`: 开机即为该用户启动 user manager, 登出后保留, 允许未登录用户运行长驻服务 | S16 |
| WSL systemd | `/etc/wsl.conf` 的 `[boot] systemd=true`, 需 `wsl --shutdown` 后生效 | S10 |
| WSL 空闲关闭 | `instanceIdleTimeout` 默认 15000 ms, -1 关闭; `vmIdleTimeout` 默认 60000 ms | S10 |
| WSL 局域网 | NAT 下要 portproxy (管理员, `connectaddress` 为 WSL 当前地址, 重启后变化) 或 `networkingMode=mirrored` (管理员放行 Hyper-V 防火墙, 全局影响所有发行版) | S9, S10 |
| Windows 防火墙 | 程序首次监听非回环地址且无规则时弹框; 拒绝, 无人应答或非管理员时生成 Block 规则; 显式 Block 压过 Allow; 回环监听不触发 | S8, L3 |

未核实: Engine 进程在 WSL 中常驻是否足以阻止 `instanceIdleTimeout` 关闭发行版; 从 WSL 经互操作启动的 Windows 进程, 在 WSL 侧结束代理进程时是否随之结束.

## 7. Harness version drift

| 项 | Claude Code | Codex |
| --- | --- | --- |
| 默认更新 | 原生安装后台自动更新, 下次启动生效; Homebrew, WinGet, apt 等不自动更新 [S11] | `check_for_update_on_startup` 默认检查更新 [S12] |
| 关闭更新 | `DISABLE_AUTOUPDATER=1` 停后台检查; `DISABLE_UPDATES` 封住全部更新路径 [S11] | `check_for_update_on_startup = false` (文档称只在集中管理时关闭) [S12] |
| 按版本安装 | `install.sh` 或 `install.ps1` 接受版本号或通道; npm `@anthropic-ai/claude-code@<v>` [S11] | npm `@openai/codex@<v>`, 平台包按版本别名发布 [S13] |
| 通道 | `latest` 与 `stable` (约晚一周) [S11] | npm `latest` 与 `alpha` [S13] |
| 版本范围强制 | 托管设置 `requiredMinimumVersion`, `requiredMaximumVersion` [S11] | 未查到 |
| 旧版本保留 | 原生安装只保留启动器所指, 本机正在运行, 最新两个版本 [S11] | 未查到 |
| 已知因升级失效 | 官方排错表: v2.1.265 到 2.1.267 与 v2.1.275 的新请求内容令校验严格的网关整批 400, 随后版本修复 [见平台模型路径报告 S3] | `wire_api` 只支持 `responses` [S12] |
| 11-13 版本 | npm `stable` 2.1.311, `latest` 2.1.322; 本机 2.1.322 [S13, L5] | npm `latest` 0.167.2; 本机 0.167.0 [S13, L5] |

推断: Engine 每回合起一个 `claude -p` 进程 (见 Engine 运行合同), 用户的交互会话自动更新后, 同一流程的下一回合就会换到新版本; Codex App Server 只在重启时换版本.

## Risks and open items

1. 未在本机验证: WSL 中运行 llama.cpp CUDA 构建的速度与内存 (本机 WSL 内存上限 16 GB, 模型文件 9.5 GB); `--sleep-idle-seconds` 是否释放显存; 互操作启动的 Windows 进程的结束方式; WSL 常驻进程与空闲关闭.
2. 判断模型候选更新很快 (榜单与 llama.cpp 构建都按天变化); 固定版本意味着 ARW 发布要负责更新候选目录并重新做兼容核对与 ARW 案例评测.
3. 非 NVIDIA 显卡与 macOS 的探测与构建选择只有文档依据, 没有实测.
4. 两个 harness 的版本都一两天一变; 经兼容端点接入的模型随时可能因新请求字段而失效 (Claude Code 已有实例).
5. Windows 防火墙的提示行为在不同版本的官方页面描述有出入 (见 v1-verify 记录); 本机实测与 2026-10-08 版一致.

## Sources

| 编号 | URL 或出处 | 访问日期 |
| --- | --- | --- |
| S1 | https://docs.nvidia.com/deploy/nvidia-smi/index.html | 2026-11-13 |
| S2 | https://raw.githubusercontent.com/ggml-org/llama.cpp/master/tools/server/README.md | 2026-11-13 |
| S3 | https://learn.microsoft.com/en-us/windows/wsl/wsl-config (`[gpu]` 节) | 2026-11-13 |
| S4 | https://api.github.com/repos/ggml-org/llama.cpp/releases (b12323 到 b12328 的资产与 `digest`) | 2026-11-13 |
| S5 | https://github.blog/changelog/2025-06-03-releases-now-expose-digests-for-release-assets/ | 2026-11-13 |
| S6 | https://huggingface.co/docs/huggingface_hub/guides/download | 2026-11-13 |
| S7 | https://huggingface.co/api/models/bartowski/fastino_GLiDE-9B-GGUF?blobs=true 与对 `resolve/main/fastino_GLiDE-9B-Q8_0.gguf` 的 HEAD 响应头 | 2026-11-13 |
| S8 | https://learn.microsoft.com/en-us/windows/security/operating-system-security/network-security/windows-firewall/rules (经 v1-verify 记录, 2026-10-08 版) | 2026-11-13 |
| S9 | https://learn.microsoft.com/en-us/windows/wsl/networking (经 v1-verify 记录) | 2026-11-13 |
| S10 | https://learn.microsoft.com/en-us/windows/wsl/wsl-config (`updated_at` 2026-10-16) | 2026-11-13 |
| S11 | https://code.claude.com/docs/en/setup.md | 2026-11-13 |
| S12 | https://learn.chatgpt.com/docs/config-file/config-reference (原地址 developers.openai.com/codex/config-reference 308 跳转至此) | 2026-11-13 |
| S13 | https://registry.npmjs.org/@openai/codex 与 https://registry.npmjs.org/@anthropic-ai/claude-code 的 `dist-tags` | 2026-11-13 |
| S14 | https://api.github.com/repos/openai/codex/releases | 2026-11-13 |
| S15 | https://learn.microsoft.com/en-us/windows/win32/setupapi/run-and-runonce-registry-keys (`updated_at` 2026-02-21) | 2026-11-13 |
| S16 | https://www.freedesktop.org/software/systemd/man/latest/loginctl.html | 2026-11-13 |
| L1 | 维护者本机 GLiDE-9B 部署记录 (私有任务记录) | 2026-11-13 |
| L2 | 维护者本机开启脚本 `start-glide.ps1` (私有任务记录) | 2026-11-13 |
| L3 | 维护者本机防火墙处理记录 (私有任务记录) | 2026-11-13 |
| L4 | 维护者本机 WSL 访问修正记录 (私有任务记录) | 2026-11-13 |
| L5 | 维护者本机只读查询: `nvidia-smi` (WSL 与 Windows 两侧), `claude --version`, `codex --version` | 2026-11-13 |
| L6 | 维护者本机 Strata 部署仓库 (私有) 的前端文档与安装目录手册 | 2026-11-13 |
| L7 | 维护者本机判断模型选型记录 (私有任务记录, 引 Hugging Face 模型卡与 Jev Decision Index) | 2026-11-13 |
