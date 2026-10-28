# Agent Repository Workflow Release 长期规格

## Scope

本文定义 ARW 源码仓库验证和发布稳定版本的长期规则: 发布候选, 本地检查, 跨平台 VM 验证, tag, 公开 Bootstrap 验证, GitHub 托管发布对象和失败恢复. 具体操作步骤由源码仓库专用且只能显式调用的 `$release` Skill (`.agents/skills/release/`) 拥有. [Agent Repository Workflow 长期规格](../agent-repository-workflow/spec.md) 拥有产品和仓库工作流. [开发长期规格](../agent-repository-workflow-development/spec.md) 拥有 Workflow Distribution 与平台投影. [安装长期规格](../agent-repository-workflow-installation/spec.md) 拥有 Bootstrap, 安装来源与载荷, Identity, Installation Contract 和 ARW 安装目录.

## Release validation configuration

根 `release-validation.json` 只保存规范 HTTPS 远端 `repositories.sourceCheckout.url`. Bootstrap 生成物从它投影远端, 正式推送和 tag 后验证都使用它. 它没有版本字段, 因为配置与读取代码由同一 Git 提交绑定. VM 位置, 快照和凭据由维护者在仓库外的 VM JSON 中提供, 不进入仓库, issue 或发布证据.

## Release procedure

1. Main Agent 读取 `package.json.version`, 取得维护者对该准确版本进行发布验证的确认. 确认不授权任何外部写入. 版本必须高于候选可达的全部稳定 tag, 且该 tag 在本地和规范远端都不存在.
2. 候选是一个已提交, 工作树干净的 commit. 在候选上运行 pnpm frozen install, `pnpm typecheck`, `pnpm test`, Workflow Distribution 检查, Bootstrap 生成物检查, 文本检查和严格术语检查.
3. 跨平台 VM 验证在每台受支持的 Windows 和 Linux 受验系统上, 从基线快照开始, 只通过宿主传入的候选 Git bundle 取得候选, 用候选自己的 `install.mjs` 和仅存在于受验系统的本地版本 tag 安装, 然后证明新开终端能解析到已安装的 `arw` 且版本正确, `arw workflow init` 与 `arw workflow verify` 在新 Git 仓库中成功, 卸载后新终端不再解析 `arw`. 结束后硬关机并还原快照. 受验系统不安装或启动 Agent CLI, 也不安装源码仓库开发依赖.
4. 任一检查发现候选缺陷时, 修复并形成新候选, 从第 2 步重新开始. 环境问题修复后只重跑受影响的检查. 临时补偿后的结果只用于诊断.
5. 全部通过且维护者授权准确项目, `origin`, 分支和版本后, 推送分支, 创建并推送无前缀的版本 tag. 规范远端第一次看到的 tag 就必须指向已验证 commit. 随后从公开 HTTPS 地址取得该 tag 的 `scripts/install-arw.mjs`, 在隔离 home 中安装并确认版本.
6. 公开 Bootstrap 验证通过后, 才发布 GitHub 托管发布对象.

## GitHub release publication

公告保存在 Repository 之外, title 和正文使用中文, 只描述在本次 tag 上可观察的变化, 并包含安装章节和 `Changelog`. Main Agent 向维护者展示准确 title 和完整公告文件, 批准绑定准确字节, 任何变化都需要重新批准.

写入前确认本地与规范远端的 tag 都指向已验证 commit, 并完成 `gh` 认证预检. 先只读查看同 tag 的 Release: 已存在且 tag, 经 Git 解析的 commit, title 和正文全部匹配, 并且是正式已发布对象时, 视为幂等成功; 冲突或读取失败时停止. 只有明确不存在时才用 `--verify-tag` 创建, 不提供 `--target`. 创建后, 以及超时或结果不明时, 都只做只读核对, 不盲目重复创建. `targetCommitish` 不能证明 tag 提交.

创建 GitHub 托管发布对象是 Main Agent 使用外部维护者工具完成的操作, 不是 ARW runtime Module. ARW 代码不读取 `gh` 凭据.

## Reviewer capability tests

Reviewer 能力测试不是发布门禁. 维护者需要时显式调用源码专用的 `$reviewer-capability` Skill (`.agents/skills/reviewer-capability/`): 用 `tests/fixtures/reviewer-capability/<role>/<scenario>/` 中带隐藏预期的场景 (qwen_strata benchmark v2 (`benchmarks/multi-model-v2`) 的 4 个计划, 夹具直接保存物化结果, 不含补丁链), 通过 `arw background-agent` 在 Codex 和 Claude 后端运行 Reviewer, 再用 `scripts/reviewer-capability.mjs` 计分并组盲池, 由盲裁裁判 (至少 sonnet high) 裁决候选的召回和误报. 套件只属于 Source Checkout, 不进入 Workflow Distribution 和 release 安装包; 评分与盲裁工具的合同由[开发规格](../agent-repository-workflow-development/spec.md#module-design)拥有. 结果用于评估角色指令, 模型和报告格式, 不授权审核, 提交或发布.

## Failure recovery and authorization

本地检查和 VM 验证不需要外部写入授权, 也不写规范远端. 外部写入授权只覆盖准确项目, `origin`, 分支和版本, 不允许强制推送, 修改其他分支或 tag, 也不允许移动已经推送的 tag.

公开 Bootstrap 验证失败时, Main Agent 先证明本地与远端 tag 都仍指向候选, 再只删除这两个准确 tag 并确认两端都不存在. 无法证明时停止. 修复后形成新候选, 重新完整验证. GitHub 托管发布对象的失败发生在 tag 验证之后, 不触发 tag 恢复: 保留 tag, 记录准确远端状态并停止, 后续创建, 更新或删除需要维护者重新决定.

## Design rationale

Reviewer 能力测试只在角色指令, 模型或报告格式变化时才有意义, 不随每次发布运行. 旧的发布能力门禁用程序准备, 评分, 折减和会话检查, 这些代码大多校验程序自己产生的数据; 现在由 Agent 按 Skill 运行场景; 保留场景, 隐藏预期, 一个入口脚本及其评分与盲裁实现, 这些是评估角色指令的方法本身, 不校验程序自己产生的数据.

VM 验证只证明用户实际依赖的结果: 安装, PATH 登记, 初始化和卸载在真实 Windows 与 Linux 上可用. 它由 Agent 按 Skill 运行一个短检查脚本, 不再由程序维护场景登记表, 归档和一致性校验; 这些机制校验的大多是验证程序自己产生的数据, 维护成本远高于它们发现问题的价值. 升级, 降级, 真实目标仓库矩阵和初始化 issue 生命周期不属于发布门禁, 需要时由维护者另行要求.

## Validation strategy

固定测试验证发布配置读取, 以及 Bootstrap 生成物与配置一致. VM 验证和公开 Bootstrap 验证只在真实发布时由 `$release` Skill 执行, 不作为 implementation issue 的完成测试, 常规测试不访问公网. 源码仓库确定性测试矩阵由[验证规则](../../agents/source-checkout-validation.md#source-checkout-deterministic-coverage)承担.
