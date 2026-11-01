# Strata 提供方改用安装发布的事实

Status: ready-for-human

## What to build

实现 effort spec 的 Strata provider uses installation-published facts 节及其 Module Design: ARW 程序中不再保存任何 Strata 部署参数, 模型解析, 默认上下文档位, 前端地址和压缩提示都从配置的 Strata 安装目录读取; 驱动改用 Strata 常驻前端的公开协议. 提供方配置字段不变 (`driver`, `installationDirectory`, `maxInstances`).

代码:

1. `lib/background-agent/strata-models.mjs`: 删除写死的模型表与上下文窗口常量; 增加 effort spec 的 Interfaces 节所述模型解析; 目录调整函数改为异步, 使用已核对的提供方设置, 按配置顺序第一个 Strata 提供方调整可解析的目录条目.
2. `lib/background-agent/strata-driver.mjs`: 连接改为读取 `config/frontend.json`, 不再运行控制脚本; 删除 `runCommand` 与进程启动, 增加 `readText` Seam; 五个操作改用 Frontend protocol 表中的路径和成功判定; 启动正文只含模型名与默认档窗口; `starting` 报告为 `partial`.
3. `lib/background-agent/strata-work-policy.mjs`: 原生任务设置的 `model_context_window` 与 `model_auto_compact_token_limit` 取自模型解析, 删除写死的阈值; 基础压缩提示改为 `config/prompts/compact-prompt.txt`.
4. `lib/background-agent/model-catalog.mjs`: 把核对后的提供方设置交给异步目录调整函数; `ProviderConfiguration` 与提供方字段核对不变.
5. `lib/background-agent/manager.mjs`: 不预期改动; 驱动结果形状保持不变.

长期文档 (受保护文档, 内容以本 issue 和 effort spec 为准):

6. `docs/specs/agent-repository-workflow/strata.md`: Scope and ownership 节中 "三种量化共用本规则" 改为对所有 Strata 模型通用的表述; Runtime parameters 节改写为安装事实, 模型解析, 默认档和启动正文 (取自 effort spec), 包含选择理由与被否决方案; Compaction support 节中的窗口与阈值改为默认档, 基础文件路径改为 `config/prompts/compact-prompt.txt`, 删除 "固定支持" 表述; 该文件 Module Design 中提到固定参数的句子同步.
7. `docs/specs/agent-repository-workflow/spec.md`: Capacity and recovery 节的 Strata 段落改为从安装 `config/frontend.json` 取得控制地址, 接口改为 `/lease/acquire`, `/model/status`, `/model/start`, `/model/stop`, `/lease/release`, "固定模型映射" 改为 "按 `./strata.md` 的 Runtime parameters 节解析的模型与默认档"; Seams and Adapters 节的 Strata 控制服务段落改为生产 Adapter 读取安装文件并使用前端 HTTP 接口; Dependencies and Data Flow 节表格中的 Strata 安装行同步.
8. `docs/specs/agent-repository-workflow-installation/spec.md` 的 Shared model catalog 节: "三个变体" 句改为 "该安装服务的模型共用同一提供方身份和限额"; "模型映射由 ... 拥有" 改为 "模型解析与默认档由 `../agent-repository-workflow/strata.md` 的 Runtime parameters 节拥有"; 目录生成段落写明调整来自安装默认档, 安装事实无法读取时目录生成失败, 没有 Strata 提供方时不读取任何安装文件. 各规范测试段落中涉及固定 Strata 参数的观察同步.

完成后在 `lib/` 和 `docs/` 中 grep `Run-Strata-Controller`, `/ownership/`, `206584`, `150000`, `spec-min-p`, `compact_prompt.txt`, `固定模型映射`, `三个变体`, `三种量化`, `qwen3.8`, 只允许测试数据中出现作为样例的模型 ID.

测试: 按 effort spec 的 Testing 节更新 `tests/background-agent/strata-driver.test.mjs`, `tests/background-agent/model-catalog.test.mjs`, `tests/background-agent/host.test.mjs` (测试安装目录提供 `config/frontend.json`, `config/deployment.json` 和新压缩提示路径); `tests/background-agent/manager.test.mjs` 使用注入的假驱动, 只在需要时调整.

体积预算: 非测试代码净增约 +28 行 (模型解析与异步目录调整约 +20, 前端路由表与读取 Seam 约 +6, 其余约 +2); 上限 +40.

预期验证: `node --test tests/background-agent/strata-driver.test.mjs tests/background-agent/model-catalog.test.mjs tests/background-agent/host.test.mjs tests/background-agent/manager.test.mjs`; Source Checkout 完整验证 `pnpm test`, `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`; 新建或语义修改的测试回调不超过 100 毫秒; 改动的规范运行 `arw text check`. 平台: Strata 分支只属于 Codex 后端; Claude 后端读取提供方设置的既有测试保持通过, 且 Claude 路径不读取 Strata 安装文件. 不改 Reviewer 规则 (`strata.md` 是程序治理, 不是 Reviewer 指令), 不做 Reviewer 能力对比. 真实 Strata 安装上的冒烟检查不是验收条件: 提交后在有 Strata 的机器上重新 `node install.mjs`, 再按该机器自己的流程运行一次, 需使用者同意.

边界情况: 模型 ID 无匹配或多匹配; 档位缺失; 档位中 `auto_compact_token_limit` 不小于 `context_window`; `config/frontend.json` 缺失或 `port` 不是正安全整数; 状态为 `starting`; 没有 Strata 提供方时目录生成不读取安装; Strata 安装部署配置无法读取时目录生成失败; 恢复任务重新读取默认档, 压缩绑定核对不变.

## Acceptance criteria

- [ ] `git grep -n -e "qwen3" -e "206584" -e "150000" -e "spec-min-p" -e "IQ3_XXS" -e "Run-Strata" -e "/ownership/" -e "compact_prompt.txt" -- lib docs` 没有输出.
- [ ] 测试证明启动请求为 `POST /model/start`, 正文恰好是解析出的 Strata 模型名和默认档窗口两项.
- [ ] 测试证明模型解析的成功, 无匹配, 多匹配, 档位缺失和档位无效结果, 且失败时不发出启动请求.
- [ ] 测试证明连接只读取 `config/frontend.json` 而不启动进程, 前端配置缺失或无效时报告错误, 五个操作使用 Frontend protocol 表的路径和成功判定, `starting` 报告为 `partial`.
- [ ] 测试证明共享模型目录只调整可解析的条目, 其他条目不变; 没有 Strata 提供方时不读取安装文件; 安装部署配置无法读取时目录生成失败并给出原因.
- [ ] 测试证明原生任务设置的窗口, 压缩阈值和基础压缩提示路径取自安装事实.
- [ ] 提供方配置仍只接受 `driver`, `installationDirectory`, `maxInstances`, 未知字段仍被拒绝.
- [ ] 第 6 至 8 项的长期规范已按 effort spec 更新, 与实现一致.
- [ ] 预期验证中的命令全部成功.

## Blocked by

- issue:0023:01

## Comments

- 依赖 01 的原因: 两者都改安装规范的 Shared model catalog 节, 先完成 01 以免冲突.

- 规划记录, 待用户决定: 本 issue 不只是移除写死的参数, 还把驱动从已被 Strata 删除的控制脚本与 `/ownership/*` 接口迁移到当前常驻前端协议. 原因是当前 Strata 只接受模型和上下文档位两项启动参数, 其余参数由安装按机器预置; 若只把参数移入 ARW 配置而不迁移协议, ARW 仍无法调用当前 Strata. 用户确认该范围后, Main Agent 把 Status 改为 `ready-for-agent`, 再按 `spec-readiness` Skill 以 effort spec 为治理 spec 安排就绪审核.
