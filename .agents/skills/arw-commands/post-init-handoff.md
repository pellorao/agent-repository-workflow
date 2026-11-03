# Post-init handoff

`arw workflow init` 成功后, 使用完整的 Agent Post-init Handoff, 并审计其中列出的每个就绪范围. ARW Engine 观察到的缺口是该审计的输入, 不证明不存在其他缺口.

- 根 `CONTEXT-MAP.md` 和根 `CONTEXT.md` 都不存在时, 视为领域文档缺口, 在合并的完成 issue 中加入 Repository Profile 选定的布局: `single-context` 需要结构有效的根 `CONTEXT.md` (可以没有 `## Language` 条目); `multi-context` 需要非空的根 `CONTEXT-MAP.md` 及其标识的每个 `CONTEXT.md`. `workflow init` 本身不创建这些文档.
- Repository-owned 规则与已安装的 Baseline 规则冲突时, 以 Baseline 为准. 检查与其责任重叠的每条 Agent 指令, 删除或重写冲突的 Repository-owned 规则, 删除语义重复项, 保留不冲突的规则. 现有权威无法判定是否冲突时, 停止受影响的工作并询问用户.
- 完整审计没有缺口时不创建 issue. 仍有缺口时, 精确创建一个合并的仓库工作流完成 issue, 包含全部领域文档, 验证, 写作, `.arwignore`, 记录迁移, 受管理区域, 语义去重和 Code Map 工作, 并在普通实施前完成它.
- 审计每个由 Agent 管理的文档或规划记录路径中使用本地语言的文件名, 为每个需要决定的路径建议一个英文文件名. 还缺少任何文件名选择时, 合并 issue 设为 `Status: needs-info`. 用户可以接受建议, 换成另一个英文文件名, 保留当前名称, 或一次选择保留全部当前名称. 记录全部选择并解决其他阻断项后, 才改为 `Status: ready-for-agent`.
- 每个保留的当前文件名, 在 `docs/agents/writing.md` 的 Repository-owned 区域添加明确例外, 记录精确路径, 当前标题路径和替代内容规则. 例外只适用于经过审查的现有文件, 文件删除或重命名后删除该例外, 不授权未来文档使用本地语言文件名.
