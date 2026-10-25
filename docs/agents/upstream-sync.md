# Upstream Sync 工作流

## Terms introduced in this document

- **Upstream Source**: ARW 从中采用所选内容的已配置外部项目和不可变提交.

## Scope

只有当 ARW Source Checkout 从已配置的 Upstream Source 采用新的精确提交时, 才使用该工作流. 准备, 审查, 批准, 最终化, 恢复或中止同步前, 阅读 [Upstream Sync 长期规范](../specs/agent-repository-workflow-upstream-sync/spec.md). 一个 Upstream Source 负责一个来源目录及其固定提交历史.

Upstream Sync 通过用户审查的 Base/Ours/Theirs 迁移更新实际 `.agents/skills/` 内容和来源本地同步状态:

- Base 是先前采用的提交的所选快照.
- Ours 是当前 Source Checkout 的 `.agents/skills/`.
- Theirs 是所请求提交的所选快照.

Workflow Distribution 不是 Ours, 且不由该工作流写入.

该工作流不是 `arw workflow update`, 不是生成 Workflow Distribution 的发布前同步, 也不是目标仓库的修复路径. Source Configuration, 快照, 活动工作区和 Sync Record 只属于 Source Checkout. 它们都不会进入 Engine Installation 或目标仓库 Projection.

## Preconditions

执行 `prepare` 前:

- 确认活动 issue 授权所选来源和迁移范围.
- 阅读 `upstream/sources/<source>/source.json`. `<source>` 目录名是 Upstream Source 身份.
- 确认配置只包含当前上游 URL, 固定提交, `platform`, Source Scope, `additionalSkillReferences` 和 `skillReferenceNormalizations` 合同. 其字段按精确顺序排列为 `url`, `commit`, `platform`, `scope`, `additionalSkillReferences`, `skillReferenceNormalizations`. `scope` 使用 `include`, `exclude`.
- 要求完整且不可变的目标提交 ID. 不接受分支, 标签, 缩写提交, SCP 简写, 本地路径, `file:`, `git:`, 纯 HTTP 或 Git 远程辅助程序.
- 运行 `node scripts/upstream-sync.mjs status`. 只允许存在一个活动工作区. `awaiting-commit` 工作区在其 HEAD 检查点满足前阻止再次准备.
- 确保引用审查将读取的每个 Git 管理路径都没有未暂存或未跟踪内容. 允许已暂存内容. 无关的仓库变更不进入该事务.
- 确认 `.agents/skills/` 是实际的当前 Ours. 不得先同步 `distribution/`, 也不得用它替代 Ours.

把已配置 URL 作为一个参数值传给 Git, 不使用命令解释器. 拒绝以下 URL:

- HTTPS 和 SSH URL 中嵌入凭据.
- 包含 NUL 或换行的 URL.
- 采用前导选项形式的 URL.

获取操作只证明 Git 返回已配置的提交和字节. 它不证明作者, 签名者, 托管账户, 物理端点或历史引用的不可变性.

## Source Configuration and selection

Source Configuration 不包含 `version`, `provenanceId`, Skill 目标映射, 法律资料对象 ID, 许可证目标映射, `requiredLegalIds`, `upstreamPath`, Workflow Distribution 路径或 Workflow Distribution 合同版本. 准备同步时不得恢复这些字段.

`platform` 的精确值是 `codex` 或 `claude-code`. 它从 `distribution/projections/config.json` 选择来源语法规则. Platform Adapter 在语义合并前, 分别把 Base 和 Theirs 转换为统一 Codex 格式. 不得向 Upstream Sync 添加 Claude Code 特有的转换分支.

Source Scope 包含分别排序和去重的 `include` 与 `exclude` 列表. 路径匹配 `include` 且不匹配 `exclude` 时被选中. `exclude` 优先. 这些列表选择来源输入, 不是 Skill 引用允许列表. 已配置路径语法支持 `/`, 路径段内的 `*`, 跨路径段的 `**` 和单字符 `?`. 它不支持有序否定, 重新包含, 花括号或字符类.

只有模式为 `100644` 或 `100755` 的可移植普通 Git blob 才能进入 Base 或 Theirs. 拒绝:

- 符号链接, `gitlink` 和特殊项.
- 无效 UTF-8 路径, 绝对路径或点路径.
- 包含反斜杠或控制字符的路径.
- Windows 禁止或保留名称.
- 末尾带点或空格的路径.
- 不区分大小写的冲突.

所选 Skill 始终直接落在 `.agents/skills/<skill-name>/`, 不保留额外层级. 许可证输入作为普通的精确来源文件进行选择, 并落在固定的 Source Checkout 许可证目标. Source Configuration 不重复任何目标映射.

准备期间, 从已配置的固定提交获取 Base, 从实际 `.agents/skills/` 读取 Ours, 从所请求提交获取 Theirs. 快照只存在于 `upstream/.workspaces/active/`. Base 字节是合并权威. Git 祖先关系只是一项审查问题, 分类为 `same`, `descendant`, `ancestor`, `diverged`, `unrelated` 或 `unknown`.

如果所选 Theirs 快照与所选 Base 快照具有相同的路径, 模式和字节, 准备报告没有所选来源变更, 保持 `idle`, 不读取 Ours, 不创建工作区, 也不移动固定提交.

## Commands and Module boundary

只使用以下 Source Checkout 命令:

```text
node scripts/upstream-sync.mjs prepare --source <source> --to <full-commit-id>
node scripts/upstream-sync.mjs status
node scripts/upstream-sync.mjs review
node scripts/upstream-sync.mjs review --confirm <additional-skill-references-hash> <skill-reference-normalizations-hash>
node scripts/upstream-sync.mjs approve
node scripts/upstream-sync.mjs finalize
node scripts/upstream-sync.mjs abort
```

`scripts/` 入口是 Module Interface 上的一层薄 CLI Adapter:

```text
prepare(source, targetCommit)
status()
createReviewRevision(confirmHashes = undefined)
recordApproval(attestation)
finalize(recoveryAuthorization = undefined)
abort(recoveryAuthorization = undefined)
```

Module 负责获取, Source Scope, Base/Ours/Theirs, 来源平台转换, 语义合并, 许可证检查, 读取 Skill 引用审查结果, 工作区状态, Review Revision 绑定, 规范事务, 恢复, Sync Record 和 HEAD 检查点. CLI 不复制布局, 合并, 事务或批准策略.

`status()` 是只读的. 它报告当前状态, 稳定诊断信息, 恢复状态和允许的操作. 存在活动工作区时, 第二次准备会以关闭方式失败.

初次 `review` 调用根据准备保存的精确 Theirs 快照运行共用 Skill 引用审查. 如果未变更的非空结果要求用户确认, 它返回两个结果哈希并保持 `resolving`. 用户确认保留每个候选项后, 按规定顺序使用两个哈希调用一次 `review --confirm`. 已完成的初次审查或已确认审查会在同一操作中继续构建 Review Revision.

状态精确为:

```text
idle | resolving | reviewed | approved | recovering | awaiting-commit | checkpoint-satisfied
```

不得通过检查工作区文件来推断其他状态或允许的操作.

## Workflow handoffs

- 准备或审查本地差异, Skill 引用结果, Review Revision 或用户批准前, 阅读 [Upstream Sync Review](upstream-sync-review.md).
- 最终化或中止同步, 恢复工作区或检查后续 Workflow Distribution 边界前, 阅读 [Upstream Sync Finalization](upstream-sync-finalization.md).

## Diagnostics and exits

公开输出是确定性的. 结构化诊断信息按阶段, 归一化路径, 代码和身份排序. 诊断信息写入标准错误. 主要状态, 交接和结果资料写入标准输出. 动态值使用可逆方式转义.

退出码 `0` 表示成功, 空操作, 只读状态成功或交互式取消. 退出码 `1` 表示问题, 阻断项, 运行时或操作失败, 恢复要求或部分应用. 退出码 `2` 只表示用法错误. 未单独确认确有需要前, 不得引入领域特有的退出代码或新的公开 JSON 协议.

## Target Repository separation

目标 `arw workflow update` 只使用已安装的 Workflow Distribution, 当前锁, Repository Profile 和目标仓库字节. 它绝不使用 Source Configuration, Base/Ours/Theirs, Approval Attestation, Sync Record, 工作区或 Agent 语义解决结果.
