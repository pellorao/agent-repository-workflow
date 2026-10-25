# Upstream Sync 审查

## Skill reference review

Base 使用已经存储在当前 Source Configuration 中的 `additionalSkillReferences` 和 `skillReferenceNormalizations`. 这些列表只适用于精确的 Base 提交.

Theirs 必须根据精确的 Theirs 快照生成新的完整候选项集合. 即使 Git 祖先关系或当前字节使继承看起来安全, 它也不继承 Base. 任一快照都可能引用平台提供的 Skill 或其他范围外 Skill.

使用共用审查命令, 通过已配置且能够等待的 `reviewEditor` 按顺序打开这些文件:

```text
additional-skill-references.txt
skill-reference-normalizations.jsonl
```

启动编辑器前说明:

- `additional-skill-references.txt` 列出未解决的身份. 只有某行指明真实的范围外 Skill 时才保留它. 其中有效的来源标记会转换为统一 Codex 语法. 如果身份不是 Skill, 删除该行. 其标记保持不变.
- `skill-reference-normalizations.jsonl` 列出没有有效终止符的精确标记位置. 只有它是真实的 Skill 引用时才保留该行. Platform Adapter 在转换前插入一个 ASCII 空格.

第一个编辑器关闭后, 命令验证其内容. 第二个文件随后包含范围内 Skill 和第一个文件中保留的额外 Skill 的规范化位置. 最终读取和 `review --confirm` 会精确强制执行该集合.

用户保留接受的行并删除其余行. 命令接受只删除内容的修改和有效 JSONL.

未变更的非空文件要求用户明确确认保留每一行. 关闭编辑器或不作修改不构成确认. 只有在此之后, 才使用返回的两个哈希调用 `review --confirm`.

第一次审查调用打印两个哈希, 按相同顺序分别对应两个修改后的结果. 如果非空候选项文件在字节层面没有变化, 询问用户是否确认不删除任何候选项. 确认后, 使用 `--confirm` 和两个哈希再次调用审查. 不得把它们组合成第三个哈希, 包含原始候选项字节或保存持久确认资料.

Review 不编辑 `source.json`. Prepare 先保存精确的 Theirs 快照. Upstream `review` 随后通过共用引用审查 Interface 使用该快照, 并在候选 Source Configuration 中包含完整的已审查结果. 如果保存的快照或其他受审输入在创建 Review Revision 前发生变化, 丢弃审查并重新开始. 不得添加其他跨命令快照或哈希.

## Prepare and Agent resolution

Main Agent 从用户的同步请求开始, 检查 issue 和前提条件, 然后运行准备. 用户也可以直接调用准备.

Prepare 创建确定性的可丢弃状态, 并说明剩余的解决工作. 它不能完成语义解决, 用户批准或规范提升.

Main Agent 按 [共同写入规则](agent-writes.md) 准备基线并协调互不重叠的范围, subagent 可以在获分派范围内直接修改候选内容. 解决期间, Agent 和用户的修改保留在活动工作区中的候选实际 Skill 和解决记录内. 绝不编辑 Base 或原始 Ours 快照.

根据精确的存在状态和字节解决每条路径:

- 如果 Ours 等于 Base, 采用 Theirs.
- 如果 Theirs 等于 Base, 保留 Ours.
- 如果 Ours 等于 Theirs, 保留共同结果.
- 如果 Ours 和 Theirs 都不同于 Base, 运行确定性的文本三方合并. 即使文本合并没有冲突, 也要把结果包含在适用的用户审查批次中.

只有 Markdown 文件执行 Skill 引用转换. 其他安全普通文件保留精确字节. Base 和 Theirs 在语义三方合并前转换为统一 Codex 语法.

直接根据精确投射的 Base 和 Ours 路径, 模式和字节, 计算完整的本地差异路径集合. 不得创建或使用 `semantic-deltas.json`, `active-deltas.json`, `delta-lifecycle.json`, 稳定差异 ID, 重复理由或不变量记录, 以及按差异选择的验证程序.

不得创建或使用 `semantic-reviews.json` 或其他由 Agent 编写的结果文件. 只在 Ours 中发生变化的路径遵循确定性合并规则.

从 Ours 到 Candidate 添加, 删除或修改的每个 Skill 都必须进入一个用户审查批次. 分组规则如下:

- 把语义重命名视为包含两条路径的一个批次, 而不是独立的删除批次和添加批次.
- 跨 Skill 的变更使用相同的语义合并选择时, 把它们分组, 包括共用的 `agents/openai.yaml` 或前置元数据规则.
- 不得仅因文件类型相同, 就把具有不同语义后果的变更分到同一组.

对于每个批次, 使用 `grilling` 解决尚未确定的每项重大语义选择. 达成共识后, 应用已经同意的 Candidate 变更, 使用普通语言说明合并内容, 并提供一条仅限于该批次路径的 `git diff --no-index` 命令. 该命令比较保存的 Ours 快照和当前 Candidate, 并包含重命名涉及的两条路径. 说明退出 `1` 表示所请求的差异存在. 用户在批准批次前审查该说明和命令输出. 如果已批准路径后续发生变化, 再次审查该批次.

每个批次获得批准后, 把相应的自然语言合并说明添加到唯一的非空 UTF-8 工作区文件 `agent-merge-notes.md`. 该文件只包含已批准的决定, 可以把相关路径分组, 且没有固定的逐路径模式, 状态值, 机械合并类别或规定措辞. 每个批次都处于当前状态并获批准后, 用户使用完整文件进行最终 Candidate 批准. Module 把文件的精确字节绑定到 Review Revision, 但不解析或判断其内容. 该文件保持为可丢弃的工作区状态, 不复制到 Sync Record.

把文本冲突, Agent 解释, 许可证变更, 来源关系, 配置漂移和 Skill 引用决定保留为独立问题. 删除按差异选择的验证程序不会创建新的全局候选内容非空规则.

License 资料不可合并. Candidate 字节必须与 Theirs 完全相同. Base/Theirs 许可证变更是必须提交用户处理的问题, 且不能通过编辑许可证文本解决.

## Review Revision

运行 `node scripts/upstream-sync.mjs review` 开始构建 Candidate. 第一次调用根据保存的 Theirs 快照运行共用 Skill 引用审查. 如果它报告未变更的非空结果需要确认, 询问用户是否应保留每个候选项, 然后使用报告的两个哈希运行一次 `node scripts/upstream-sync.mjs review --confirm <additional-skill-references-hash> <skill-reference-normalizations-hash>`. 已完成的初次审查或已确认审查会继续构建并验证候选实际 Skill 树和 Source Configuration. 缺失或不完整的合并说明会使工作区保持 `resolving`. 所有合并批次都获得批准且说明完整后, 再次运行 `review` 构建最终 Review Revision. 没有独立的公开验证命令.

所有当前批次都获得批准后, 相同的摘要值相关输入会产生相同的 Review Revision. Review Revision 绑定用于批准的精确 Projection Definition, Candidate, 来源状态和 `agent-merge-notes.md` 字节. Candidate, 说明, 配置, Projection Definition, 许可证, 来源或引用审查输入的任何变化都会使修订版本和批准失效.

Review 必须覆盖可移植的 Source Scope, 确定性顺序, 无效 Git 项, 许可证直接传递, 单个活动工作区, 空操作选择, 所有 Base/Ours/Theirs 状态, 添加, 删除, 语义重命名, 分组合并规则, 精确的批次差异命令, 不执行语义解析的精确 Agent 说明绑定, 引用转换, 摘要值过期, 中止, 最终化恢复和重复的已最终化同步.

## Human review and approval

用户批准与 Interface 无关. 它可以发生在本地 CLI, Agent 对话, 远程环境, Git 托管审查或未来的人工介入界面中. Agent 可以说明证据并转录已经发生的决定, 但不能制造批准.

`approve` 记录一份 Approval Attestation, 绑定当前 Review Revision, 精确的 `agent-merge-notes.md` 摘要值, 候选来源摘要值和候选实际 Skill 摘要值. 它还记录非空渠道, 以及用户确认文本或外部证据引用. 无效, 不完整或已过期的输入不会创建批准记录.

Source 摘要值绑定已经获取和配置的来源状态. Actual Skill 摘要值绑定 finalize 将写入的规范交付内容. Workflow Distribution 不属于任何一个摘要值. Candidate 发生变化会使批准过期.
