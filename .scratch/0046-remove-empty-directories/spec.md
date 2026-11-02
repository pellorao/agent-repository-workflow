# workflow remove 清理自己删空的目录

## Behavior

`arw workflow remove` 删除受管文件和用户选择删除的仓库自有文件后, 这些文件的父目录可能变空, 如 `.agents/skills/*/agents`, `docs/agents/roles/spec-readiness-reviewer`, `docs/licenses/arw`. Git 不跟踪空目录, `git status` 看不到它们, 但工作区留下整棵空目录树.

事务成功删除全部计划内的文件 (含最后的锁文件) 之后, 命令清理目录:

1. 收集所有被删文件的各级祖先目录, 不含仓库根, 先去重 (同一目录下删除多个文件只处理一次), 再按路径深度从深到浅排序.
2. 逐个处理: 目录已不存在 (如已被之前的清理删除) 时直接跳过, 不算残留; 存在但不是普通目录 (符号链接, 联接, 越界) 或检查, 列举, 删除失败时不删除并算残留; 普通目录没有任何条目时删除它, 否则保留 (正常保留, 不算残留). 因为自下而上, 子目录删除后其父目录才可能被判定为空, 整棵空树一次清理完.

只检查被删文件的祖先, 所以删除前就已为空的目录不动 (它不在任何被删文件的祖先链上, 或其祖先链因含它而不会变空); 仍含任何条目 (用户文件, 保留的仓库自有文件如 `.codex/config.toml`, 预先存在的空子目录) 的目录也不动, 这是正常保留, 不算残留. 这个边界让 ARW 只清理自己制造的垃圾, 不碰用户自己的目录结构. `arw.config.json` 由用户拥有且不属于受管删除, `.codex/config.toml` 按既有规则保留, 二者的保留保持不变, 并使它们所在的目录保留.

### Failure boundary

长期规范 `docs/specs/agent-repository-workflow/spec.md` 的 `Shared safety and failures` 节要求写入操作在符号链接, 目录联接, 路径越界和状态漂移时关闭式失败. 目录清理对这条规则是限定例外: 对目录本身仍关闭式处理, 即不跟随符号链接或目录联接, 不离开仓库根, 检查与删除之间状态漂移时不删除 (非递归删除, 非空目录不会被删); 但这些拒绝以及检查或删除抛出的错误只作为清理拒绝报告, 不使已经完成的 `remove` 失败, 因为文件删除和锁文件处理已经在清理之前成功, 回滚或判失败只会掩盖已完成的结果.

拒绝的目录不删除, 其余目录继续处理. 事务之后的状态:

- 公开结果 `applied` 为真, `leftoverDirectories` 按路径排序列出被拒绝的仓库相对目录; 没有拒绝时不含该字段.
- CLI 向标准输出 (与 `workflow update` 的类似提示一致) 在 `workflow remove` 现有的全部输出 (含完成消息) 之后写一空行, 一行准确的 `These directories could not be removed and were left in place:` 和每个路径一行 `- <path>`, 退出状态不变; 字段缺失时输出与现状逐字节相同.
- 提示不声称目录为空: 被拒绝的目录可能已有进程新建了内容或无法列举, 用户删除前自行检查. 不要求恢复或重试 `remove`.

### Testing

用 mock Git 仓库和文件系统替身, 不启动真实进程. 情境: init 之后 remove, 观察 (a) 受管文件的整棵空目录树被删除, (b) 用户在受管目录中放入的文件使其所在的目录链保留且不算残留, (c) 事先存在的空目录保留, (d) `.codex/config.toml` 与 `arw.config.json` 及其目录保留, (e) 替身让某个目录是符号链接或其删除失败, 观察操作仍 `applied` 为真, 该目录不被删除并出现在 `leftoverDirectories`, 其余目录照常清理, (f) CLI 在残留时于全部现有输出之后向标准输出写出准确的提示 (标准错误不含它) 且退出 0, 无残留时输出不变. 这些观察防止清理过度 (删除用户目录), 不足 (残留空树), 越界, 以及清理失败被误报为操作失败.

## ADR Evaluation

本次改变不引入新的权威来源或持久状态: 目录清理只读取当前文件系统状态, 不写入锁文件或其他记录. `docs/adr/0017-use-operation-specific-recovery-baselines.md` 的决定不受影响: 它以 Git 索引为 Repository Workflow 的恢复基线, 部分失败后由用户把工作树恢复到索引; 被清理的是祖先目录且只用非递归方式删除空目录, 不含任何文件内容, 位于 Git 跟踪与恢复基线之外, 所以不会丢失数据, 也不改变已有的恢复合同.

对写入安全规则的限定例外存在真实取舍 (清理被拒绝时退出码仍为 0, CLI 调用方只能看标准输出的提示文本, 只有仓库内的 Module 调用方能拿到 `leftoverDirectories`; 残留目录是 ARW 出于安全没有动的目录, ARW 没有往里写任何东西, 也没有删除里面的内容; ARW 管理的文件已全部移除, 主事务已提交, 后续命令不受影响; 用户可按提示自行检查后决定是否删除), 并明确偏离长期规范的通用规则, 所以新增 `docs/adr/0038-report-remove-directory-cleanup-refusals-as-leftovers.md` 记录该决定和理由; 长期规范 `remove` 一节引用它.

## Module Design

### Modules

- Repository Workflow Module (`lib/repository-workflow/workflow.mjs`): 责任增加 `remove` 事务成功后的目录清理, 并拥有其拒绝处置.
- CLI (`lib/arw.mjs`): 责任不变, 仍只拥有语法, 输入输出和退出码映射; 新读取一个结果字段并输出提示.

### Interfaces

- `runRepositoryWorkflow` 的 `remove` 结果新增可选字段 `leftoverDirectories: string[]` (按路径排序的仓库相对目录, 没有清理拒绝时省略); `applied`, `diagnostics`, `plan` 和 `verified` 的含义不变. 清理使用该 Module 已有的文件系统 Interface 中的 `removeEmptyDirectory` (Module Interface 在这里新增的是它的结果语义): 适配器内部先用 ScopedFilesystem (`lib/common/filesystem.mjs`) 的 `inspect`, 非目录或链接一律拒绝, 路径不存在时返回成功 (`removed: false`) 且不算残留, 否则做非空即失败的非递归删除 (非空由底层原子判定), 并返回文件系统结果而不是抛出; 不新增输入, 选项或文件系统能力.
- CLI 的 `readWorkflowResult` 读取该字段 (数组元素按字符串规范化, 与同文件的 `droppedRoleSeeds` 等字段一致), 输出规则见 Failure boundary 节.

### Seams and Adapters

不变: 文件系统 Seam 仍是 Repository Workflow 的 `RepositoryFilesystem`, 测试经它注入替身.

### Dependencies and Data Flow

数据流增加一步: 事务成功 -> Module 对被删文件的祖先目录自下而上清理 -> 被拒绝的目录汇入结果的 `leftoverDirectories` -> CLI 读取并输出. 依赖方向, 权威来源 (锁文件与计划) 不变.

### Module Design Rationale

清理放在 Module 内而不是 CLI: 它是写入文件系统的行为, 需要文件系统 Seam 与路径安全, CLI 不重新读取文件系统. 用结果字段而不是失败诊断: 现有 CLI 只要有诊断就判失败并丢弃 `blocking`, 而残留目录不影响已完成的结果, 同类提示 (`droppedRoleSeeds`, `removedConfigFields`) 已采用结果字段.

### ADR Evaluation

见上文 `ADR Evaluation` 节: 无新的权威来源, 持久状态或恢复合同; 新增 `docs/adr/0038-report-remove-directory-cleanup-refusals-as-leftovers.md` 记录限定例外.
