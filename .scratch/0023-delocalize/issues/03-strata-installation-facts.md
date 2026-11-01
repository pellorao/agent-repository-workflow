# Strata 提供方改用安装发布的事实

Status: ready-for-agent

## What to build

实现 effort spec 的 Strata provider uses installation-published facts 节及其 Module Design: ARW 程序中不再保存任何 Strata 部署参数, 模型解析, 上下文档位, 前端地址和压缩提示都从配置的 Strata 安装目录读取; 驱动改用 Strata 常驻前端的公开协议. 提供方配置在原有字段 (`driver`, `installationDirectory`, `maxInstances`) 之外增加可选字段 `contextWindow`: 取安装为该模型发布的某一档的 `context_window`, 省略时用第一档 (默认档); 取值只在模型解析中对照安装发布的档位核对, 未发布即配置错误 (effort spec 的 Model resolution and tier selection 节).

代码:

1. `lib/background-agent/strata-models.mjs`: 删除写死的模型表与上下文窗口常量; 增加 effort spec 的 Interfaces 节所述模型解析, 按可选的 `contextWindow` 选择档位, 未发布时报配置错误; 目录调整函数按 Interfaces 节的 `applyStrataCatalogSupport(models, providers, readText?)` 改为异步, 按配置顺序第一个 Strata 提供方的安装与 `contextWindow` 调整可解析的目录条目.
2. `lib/background-agent/strata-driver.mjs`: 连接改为读取 `config/frontend.json`, 不再运行控制脚本; 删除 `runCommand` 与进程启动, 增加 `readText` Seam 和可选的 `contextWindow` 输入; 五个操作改用 Frontend protocol 表中的路径和成功判定; 启动正文只含模型名与所选档窗口; `status` 与 `start` 原样返回前端的 `model` (即 ARW 模型 ID, 不做映射); `starting` 报告为 `partial`; `reviewerTaskSupport` 把 `contextWindow` 交给任务支持.
3. `lib/background-agent/strata-work-policy.mjs`: `createStrataTaskSupport` 与 `prepareStrataSettings` 接受可选的 `contextWindow` 并交给模型解析; 原生任务设置的 `model_context_window` 与 `model_auto_compact_token_limit` 取自模型解析, 删除写死的阈值; 基础压缩提示改为 `config/prompts/compact-prompt.txt`, 仍以字节读取并按字节绑定, 不经由 `readText`.
4. `lib/background-agent/model-catalog.mjs`: 把核对后的提供方设置交给异步目录调整函数; 提供方字段核对接受 `contextWindow`, 只允许出现在 `driver: "strata"` 条目中 (与 `installationDirectory` 同一规则), 不核对取值; `ProviderConfiguration` 增加该可选字段并原样保留; 其他字段核对不变.
5. `lib/background-agent/manager.mjs`: `driverFor` 把 `contextWindow` 与 `installationDirectory` 一起交给驱动; 按 effort spec 的 Frontend protocol 节的新租约启动规则, 本次新领取租约时不论状态如何总是调用一次启动, 不先停止, 不做切换冲突检查; 已持有的租约仍按现有切换规则; 驱动结果形状保持不变, 无其他改动.

长期文档 (受保护文档, 内容以本 issue 和 effort spec 为准):

6. `docs/specs/agent-repository-workflow/strata.md`: Scope and ownership 节中 "三种量化共用本规则" 改为对所有 Strata 模型通用的表述; Runtime parameters 节改写为安装事实, 模型解析, 档位选择 (`contextWindow`, 省略时第一档, 未发布即配置错误, 只在模型解析中核对) 和启动正文 (取自 effort spec), 包含选择理由与被否决方案, 并记下 effort spec 的 Frontend protocol 节所依赖的前端协议事实 (返回的 `model` 是前端模型 ID; 启动对相同完整配置复用, 不同时自行先停再启动), 注明出处为 Strata 安装目录根下的 `README.md`; Compaction support 节中的窗口与阈值改为所选档, 恢复时重新解析, 基础文件路径改为 `config/prompts/compact-prompt.txt`, 删除 "固定支持" 表述; 该文件 Module Design 中提到固定参数的句子同步.
7. `docs/specs/agent-repository-workflow/spec.md`: Capacity and recovery 节的 Strata 段落改为从安装 `config/frontend.json` 取得控制地址, 接口改为 `/lease/acquire`, `/model/status`, `/model/start`, `/model/stop`, `/lease/release`, "固定模型映射" 改为 "按 `docs/specs/agent-repository-workflow/strata.md` 的 Runtime parameters 节解析的模型与所选档"; "提供方已无加载的根线程且无待启动工作时, 才可使用同一 key 停止旧模型并启动另一变体" 一句限定为已持有的租约, 并写明 effort spec 的新租约启动规则 (新领取租约后总是启动一次, 不先停止, 不做切换冲突检查), 其前提 (新租约时该提供方没有已加载的工作, 其他运行只在排队) 和理由; Seams and Adapters 节的 Strata 控制服务段落改为生产 Adapter 读取安装文件并使用前端 HTTP 接口; Dependencies and Data Flow 节表格中的 Strata 安装行同步.
8. `docs/specs/agent-repository-workflow-installation/spec.md`: Shared model catalog 节的提供方字段表增加 `contextWindow` 行 (可省略, 只用于 `driver: "strata"`, 取安装为该模型发布的某一档的 `context_window`, 省略时用第一档, 取值核对见 `../agent-repository-workflow/strata.md` 的 Runtime parameters 节); Background Agent configuration 节和 Shared model catalog 节列举提供方条目内部字段处加入 `contextWindow`; "三个变体" 句改为 "该安装服务的模型共用同一提供方身份和限额"; "只有可变的目录和配额在此设置" 改为也包括档位选择; "模型映射由 ... 拥有" 改为 "模型解析与档位选择由 `../agent-repository-workflow/strata.md` 的 Runtime parameters 节拥有"; 目录生成段落写明调整来自第一个 Strata 提供方的所选档, 安装事实无法读取或所配置的档未发布时按目录生成失败处理 (只影响 Codex App Server), 没有 Strata 提供方时不读取任何安装文件; 该文件 Module Design 中共享模型目录的 Seam 描述, Dependencies and Data Flow 节的数据流图和权威来源表加入 Strata 安装的 `config/deployment.json` (仅配置 Strata 提供方时读取). 各规范测试段落中涉及固定 Strata 参数的观察同步.

完成后在 `lib/` 和 `docs/` 中 grep `Run-Strata-Controller`, `/ownership/`, `206584`, `150000`, `spec-min-p`, `compact_prompt.txt`, `固定模型映射`, `三个变体`, `三种量化`, `qwen3.8`, 只允许测试数据中出现作为样例的模型 ID.

测试: 按 effort spec 的 Testing 节更新 `tests/background-agent/strata-driver.test.mjs`, `tests/background-agent/model-catalog.test.mjs`, `tests/background-agent/host.test.mjs` (测试安装目录提供 `config/frontend.json`, `config/deployment.json` 和新压缩提示路径; 档位选择测试的安装发布两档); `tests/background-agent/manager.test.mjs` 使用注入的假驱动, 增加配置的 `contextWindow` 传到驱动的观察, 其他只在需要时调整. 测试数据中的窗口值不使用某台机器的实测值 (如 `206584`, `150000`).

体积预算: 非测试代码净增约 +37 行 (模型解析与异步目录调整约 +20, 前端路由表与读取 Seam 约 +6, 档位选择与未发布错误约 +4, `contextWindow` 的配置接受与向驱动, 任务支持传递约 +3, 新租约启动规则约 +2, 其余约 +2); 上限 +49.

预期验证: `node --test tests/background-agent/strata-driver.test.mjs tests/background-agent/model-catalog.test.mjs tests/background-agent/host.test.mjs tests/background-agent/manager.test.mjs`; Source Checkout 完整验证 `pnpm test`, `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`; 新建或语义修改的测试回调不超过 100 毫秒; 改动的规范运行 `arw text check`. 平台: Strata 分支只属于 Codex 后端; Claude 后端读取提供方设置的既有测试保持通过, 且 Claude 路径不读取 Strata 安装文件. 不改 Reviewer 规则 (`strata.md` 是程序治理, 不是 Reviewer 指令), 不做 Reviewer 能力对比. 真实 Strata 安装上的冒烟检查不是验收条件: 提交后在有 Strata 的机器上重新 `node install.mjs`, 再按该机器自己的流程运行一次, 需使用者同意.

边界情况: 模型 ID 无匹配或多匹配; 档位缺失; `contextWindow` 未在该模型的档位中发布, 或不是整数 (配置错误, 不改用默认档); `contextWindow` 设在非 Strata 条目中 (拒绝); 省略 `contextWindow` 时用第一档; 新领取租约时上一个持有者留下同一模型的另一档或其他模型 (都直接发出启动, 不先停止), 此时同一提供方另一运行排队启动 (不报切换冲突); 前端返回的 `model` 与 ARW 模型 ID 前缀不同 (确认失败); 前端以 400 拒绝启动; 领取请求无法连接; 同一模型两档窗口相同 (取第一个); 档位中 `auto_compact_token_limit` 不小于 `context_window`; `config/frontend.json` 缺失或 `port` 不是正安全整数; 状态为 `starting`; 没有 Strata 提供方时目录生成不读取安装; Strata 安装部署配置无法读取时目录生成失败; 恢复任务按配置的 `contextWindow` 重新解析所选档, 安装已不再发布该档时恢复以配置错误失败, 压缩绑定核对不变.

## Acceptance criteria

- [ ] `git grep -n -e "qwen3" -e "206584" -e "150000" -e "spec-min-p" -e "IQ3_XXS" -e "Run-Strata" -e "/ownership/" -e "compact_prompt.txt" -- lib docs` 没有输出.
- [ ] 测试证明启动请求为 `POST /model/start`, 正文恰好是解析出的 Strata 模型名和所选档窗口两项.
- [ ] 测试证明模型解析的成功, 无匹配, 多匹配, 档位缺失, 档位无效和 `contextWindow` 未发布 (含非整数值) 结果, 未发布的错误消息包含配置值, 模型名和已发布的窗口, 且失败时不发出启动请求; 两档窗口相同时选第一档.
- [ ] 测试证明安装发布两档并配置 `contextWindow` 为第二档窗口时, 启动正文, 共享模型目录条目和原生任务设置 (新任务和恢复) 都使用第二档的窗口与阈值; 省略时都使用第一档; 恢复时安装已不再发布所配置的档, 任务准备以配置错误失败, 不改用其他档.
- [ ] 测试证明管理进程把配置的 `contextWindow` 交给驱动.
- [ ] manager 测试证明新领取租约时状态是 `stopped`, `unloaded`, `partial`, 目标模型 `running` 或其他模型 `running`, 都直接发出一次启动且之前没有停止, 同一提供方另一运行排队启动时也不报切换冲突; 已持有租约且模型相同时不发出启动.
- [ ] 测试证明连接只读取 `config/frontend.json` 而不启动进程, 前端配置缺失或无效时报告错误, 五个操作使用 Frontend protocol 表的路径和成功判定, `starting` 报告为 `partial`; 启动被前端以 400 拒绝时报告前端的错误消息, 启动返回的 `model` 与 ARW 模型 ID 不等时报告未确认请求的模型, 领取请求无法连接时驱动以错误失败, 领取失败时管理进程不持有 key, 不创建原生根线程.
- [ ] 测试证明共享模型目录只调整可解析的条目, 其他条目不变; 没有 Strata 提供方时不读取安装文件; 安装部署配置无法读取或所配置的档未发布时目录生成失败并给出原因 (`tests/background-agent/model-catalog.test.mjs`).
- [ ] 测试证明原生任务设置的窗口, 压缩阈值和基础压缩提示路径取自安装事实 (`tests/background-agent/host.test.mjs`).
- [ ] 测试证明提供方配置接受 `driver`, `installationDirectory`, `maxInstances` 和 Strata 条目中的可选 `contextWindow`, 拒绝非 Strata 条目中的 `contextWindow`, 其他未知字段仍被拒绝.
- [ ] 第 6 至 8 项的长期规范已按 effort spec 更新, 与实现一致 (第一条验收的 `git grep` 无输出, 并逐节对照 effort spec 核对).
- [ ] 预期验证中的命令全部成功 (逐条运行, 退出码均为 0, 记入 `## Validation`).

## Blocked by

- issue:0023:01

## Comments

- 依赖 01 的原因: 两者都改安装规范的 Shared model catalog 节, 先完成 01 以免冲突.

- 用户决定 (2026-11-02): 采用方案 A, 即本 issue 把驱动迁移到当前 Strata 公开的安装文件和前端协议, 不只是移除写死的参数. 原话要点: Strata 提供了哪些档位, 就可以选择哪些档位; 选择的档位不写死在 ARW 里, 但可以作为配置参数保存在 config 文件里. 据此不再只用默认档, 增加可选提供方字段 `contextWindow`, 省略时用第一档; What to build, 验收条件和 effort spec 已同步, Status 改为 `ready-for-agent`, 下一步按 `spec-readiness` Skill 以 effort spec 为治理 spec 安排就绪审核.
