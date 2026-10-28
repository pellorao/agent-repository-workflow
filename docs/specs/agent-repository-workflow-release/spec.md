# Agent Repository Workflow Release 长期规格

## Scope

本文定义 ARW 源码仓库验证和发布稳定版本的长期规则: 发布候选, 本地检查, 跨平台 VM 验证, tag, 公开 Bootstrap 验证, GitHub 托管发布对象和失败恢复. 具体操作步骤由源码仓库专用且只能显式调用的 `$release` Skill (`.agents/skills/release/`) 拥有. [Agent Repository Workflow 长期规格](../agent-repository-workflow/spec.md) 拥有产品和仓库工作流. [开发长期规格](../agent-repository-workflow-development/spec.md) 拥有 Workflow Distribution 与平台投影. [安装长期规格](../agent-repository-workflow-installation/spec.md) 拥有 Bootstrap, 安装来源与载荷, Identity, Installation Contract 和 ARW 安装目录.

## Release validation configuration

根 `release-validation.json` 只保存规范 HTTPS 远端 `repositories.sourceCheckout.url`. Bootstrap 生成物从它投影远端, 正式推送和 tag 后验证都使用它. 它没有版本字段, 因为配置与读取代码由同一 Git 提交绑定. VM 位置, 快照和凭据由维护者在仓库外的 VM JSON 中提供, 不进入仓库, issue 或发布证据.

## Release procedure

1. Main Agent 读取 `package.json.version`, 取得维护者对该准确版本进行发布验证的确认. 确认不授权任何外部写入. 版本必须高于候选可达的全部稳定 tag, 且该 tag 在本地和规范远端都不存在.
2. 候选是一个已提交, 工作树干净的 commit. 在候选上运行 pnpm frozen install, `pnpm typecheck`, `pnpm test`, Workflow Distribution 检查, Bootstrap 生成物检查, 文本检查, 严格术语检查和分发副本语言检查 (`arw language inspect distribution`, 只报告, 由 Agent 按 `docs/agents/writing.md` 判断).
3. 跨平台 VM 验证在每台受支持的 Windows 和 Linux 受验系统上, 从基线快照开始, 只通过宿主传入的候选 Git bundle 取得候选, 用候选打成的安装压缩包 (`scripts/pack-release.mjs`) 解压后的 `install.mjs` 和发布标签安装, 然后证明新开终端能解析到已安装的 `arw` 且版本正确, `arw workflow init` 与 `arw workflow verify` 在新 Git 仓库中成功, 卸载后新终端不再解析 `arw`. 结束后硬关机并还原快照. 受验系统不安装或启动 Agent CLI, 也不安装源码仓库开发依赖.
4. 任一检查发现候选缺陷时, 修复并形成新候选, 从第 2 步重新开始. 环境问题修复后只重跑受影响的检查. 临时补偿后的结果只用于诊断.
5. 全部通过且维护者授权准确项目, `origin`, 分支和版本后, 推送分支, 创建并推送无前缀的版本 tag. 规范远端第一次看到的 tag 就必须指向已验证 commit, 回滚后重建的 tag 同样如此. 随后在已验证 commit 的干净检出上用 `scripts/pack-release.mjs` 生成安装压缩包 `arw.tar.gz`, 其内容由该 commit 的 `release-manifest.json` 决定.
6. 创建 GitHub 托管发布对象并上传 `arw.tar.gz` 为资产. 之后从公开 HTTPS 地址取得该 tag 的 `scripts/install-arw.mjs`, 在隔离 home 中安装并确认版本.

## GitHub release publication

公告保存在 Repository 之外, title 和正文使用中文, 只描述在本次 tag 上可观察的变化, 并包含安装章节和 `Changelog`. Main Agent 向维护者展示准确 title 和完整公告文件, 批准绑定准确字节, 任何变化都需要重新批准.

写入前确认本地与规范远端的 tag 都指向已验证 commit, 并完成 `gh` 认证预检. 先只读查看同 tag 的 Release: 已存在且 tag, 经 Git 解析的 commit, title 和正文全部匹配, 并且是正式已发布对象, 且资产 `arw.tar.gz` 存在时, 视为幂等成功; 冲突或读取失败时停止. 只有明确不存在时才用 `--verify-tag` 创建, 不提供 `--target`. 创建后, 以及超时或结果不明时, 都只做只读核对, 不盲目重复创建. `targetCommitish` 不能证明 tag 提交.

发布资产是只含安装载荷的压缩包 `arw.tar.gz`, Bootstrap 按固定名称从该 release 下载. 创建 GitHub 托管发布对象是 Main Agent 使用外部维护者工具完成的操作, 不是 ARW runtime Module. ARW 代码不读取 `gh` 凭据.

## Reviewer capability tests

Reviewer 能力测试不是发布门禁. 维护者需要时显式调用源码专用的 `$reviewer-capability` Skill (`.agents/skills/reviewer-capability/`): 用 `tests/fixtures/reviewer-capability/<role>/<scenario>/` 中带隐藏预期的场景 (qwen_strata benchmark v2 (`benchmarks/multi-model-v2`) 的 4 个计划, 夹具直接保存物化结果, 不含补丁链), 通过 `arw background-agent` 在 Codex 和 Claude 后端运行 Reviewer, 再用 `scripts/reviewer-capability.mjs` 计分, 组盲池, 生成视图并统计, 由盲裁裁判 (至少 sonnet high) 裁决候选的召回和误报. 套件只属于 Source Checkout, 不进入 Workflow Distribution 和 release 安装包; 评分与盲裁工具的合同由[开发规格](../agent-repository-workflow-development/spec.md#module-design)拥有. 结果用于评估角色指令, 模型和报告格式, 不授权审核, 提交或发布.

## Failure recovery and authorization

本地检查和 VM 验证不需要外部写入授权, 也不写规范远端. 外部写入授权只覆盖准确项目, `origin`, 分支和版本, 不允许强制推送, 修改其他分支或 tag, 也不允许原地移动已经推送的 tag. 唯一例外见下一段, 发布授权同时覆盖该例外.

压缩包生成, GitHub 托管发布对象的创建, 核对或随后的公开 Bootstrap 验证失败发生在 tag 推送之后时, 回滚的边界是维护者的对外公告. 公告只在 `$release` 流程结束之后由维护者发布, 所以流程自身运行期间的失败都发生在公告之前, 此时回滚并重试; 维护者此后告知已公告时, 再发现的失败不回滚: 保留 tag, 记录准确远端状态并停止, 后续创建, 更新或删除需要维护者重新决定.

回滚只删除本次发布运行自己创建的同版本 Release 与 tag, 其他对象一律不删, 并先记录同版本 Release 的准确远端状态 (Release 不存在是有效状态, 其他读取失败时停止); 删除后核对 Release, 远端 tag 和本地 tag 三者都不存在. 任一删除或核对失败时停止并报告准确状态. 修复产生新 commit 时回到第 2 步重新验证, 候选不变时回到推送 tag. 同一版本连续回滚 2 次仍失败时停止并报告. 具体步骤由 `$release` Skill 拥有.

## Design rationale

已存在 Release 的资产字节不由发布核对比较, 公开 Bootstrap 验证用该资产实际安装并核对版本, 证明其可安装且身份正确.

公告之前无人下载该 tag 与 Release, 所以失败后整体回滚重试比停下等待更安全也更快; 公告之后 tag 可能已被依赖, 仍然保留. 回滚是删除后重建, 不是原地移动, 是对"不移动已推送 tag"的受限例外. 接受的成本: 公开 Bootstrap 验证与公告前可能的偶然获取者, 其持有的旧 tag 可能与重建的 tag 不一致, 公告前不预期有消费者, 接受该残余风险. 本例外的决定见 [ADR 0031](../../adr/0031-use-github-and-local-validation-sources.md).

Reviewer 能力测试只在角色指令, 模型或报告格式变化时才有意义, 不随每次发布运行. 旧的发布能力门禁用程序准备, 评分, 折减和会话检查, 这些代码大多校验程序自己产生的数据; 现在由 Agent 按 Skill 运行场景; 保留场景, 隐藏预期, 一个入口脚本及其评分, 报告修复, 格式罚, 暂停扣分与盲裁实现, 这些是评估角色指令的方法本身 (与 qwen_strata 的评分体系一致, 结果可比), 不是对 ARW 程序产物的发布门禁. 残差折减, 暂停计数与基线归档校验是评分体系的一部分: 归档基线是固定标尺, 其校验保证评分尺度不被意外改动, 不是校验程序运行时自己产生的数据.

VM 验证只证明用户实际依赖的结果: 安装, PATH 登记, 初始化和卸载在真实 Windows 与 Linux 上可用. 它由 Agent 按 Skill 运行一个短检查脚本, 不再由程序维护场景登记表, 归档和一致性校验; 这些机制校验的大多是验证程序自己产生的数据, 维护成本远高于它们发现问题的价值. 升级, 降级, 真实目标仓库矩阵和初始化 issue 生命周期不属于发布门禁, 需要时由维护者另行要求.

## Validation strategy

固定测试验证发布配置读取, 以及 Bootstrap 生成物与配置一致. VM 验证和公开 Bootstrap 验证只在真实发布时由 `$release` Skill 执行, 不作为 implementation issue 的完成测试, 常规测试不访问公网. 源码仓库确定性测试矩阵由[验证规则](../../agents/source-checkout-validation.md#source-checkout-deterministic-coverage)承担.
