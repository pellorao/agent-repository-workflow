<!-- arw:managed:start -->
# 领域文档

在探索不熟悉的领域, 命名持久的领域概念或决定架构边界前, 读取当前已有的持久领域文档:

- 读取每个适用的 `CONTEXT-MAP.md`, 无论它位于根目录还是领域内部. 如果根目录存在该文件, 从它开始, 然后遵循每个适用的 `CONTEXT-MAP.md`, 读取它为当前区域标识的每个 `CONTEXT.md`.
- 如果没有适用的 `CONTEXT-MAP.md` 覆盖当前区域, 直接读取每个已有且适用的根目录或领域内部 `CONTEXT.md`.
- 如果相应文档存在, 读取 `docs/adr/` 下的适用决定和 `docs/specs/<domain>/spec.md` 中的适用长期规范.

`CONTEXT.md`, `CONTEXT-MAP.md`, `docs/specs/**` 和 `docs/adr/**` 是领域文档. 根据 `writing.md` 规定的仓库文档语言规则编写它们, 不得根据当前读者或作者的身份分类.

复用已经建立的词汇. 在负责持久决定的文档中记录该决定, 并明确显示冲突, 不得默默覆盖它.

仓库具备 Repository Profile 所选的领域文档后, 才算完成对该 Workflow Distribution 的采用:

- `single-context` 仓库具有根 `CONTEXT.md`.
- `multi-context` 仓库具有非空的根 `CONTEXT-MAP.md`, 以及它所标识的每个 `CONTEXT.md`.

结构有效但没有 `## Language` 条目的 `CONTEXT.md` 是普通的空术语表, 不是占位符. 如果初始化后审计发现两个根领域文档都不存在, 就在合并的 Repository Workflow 完成 issue 中加入创建所选布局的工作. `workflow init` 本身不创建这些文档.

只在仓库有需要保存的持久决定或长期行为时创建 ADR 或 `docs/specs/<domain>/spec.md`. 缺少这些文档不会形成就绪缺口, 空占位符也不履行任何责任.

对于 Spec Readiness, 把每个适用的上下文文档明确提供为 `domain-context`, 并把每份适用的决定记录提供为 `adr`. 不得推断省略的 Input, 也不得把无关的术语表或决定作为治理证据.

## Module Design applicability

Module Design 描述正式的运行时模块. 如果工作不修改非测试运行时代码, 治理 spec 或 PRD 省略 `## Module Design`. 如果非测试运行时代码发生变化, 但 Module 责任, Interface, Seam, 依赖方向, 权威来源和数据流都不变, 则使用一个 `Not required:` 段落. 只要这些与模块相关的设计中有任何一项发生变化, 就使用完整格式. 测试, 文档和目录名称本身不决定适用性. Spec Readiness 仍然针对每个实施 issue 运行.

## Long-term specification boundary

长期规范必须能够独立阅读, 并保存持久的产品行为. 它记录实现, 调用方, 测试和 Reviewer 必须保留的内容:

- 产品边界和公开行为.
- 安全限制.
- 持久状态和状态转换.
- 必要顺序和失败语义.
- 跨文档责任关系.

不得在长期规范中放入实现文件导航, 辅助函数, 完整的依赖注入对象, 测试文件, 测试夹具细节, 穷尽式测试清单和载荷文件枚举.

把导航放入 README 或开发者指南, 把实现细节放入代码和测试, 把专门操作放入适用的 Agent 指引, 并把载荷身份放入其规范清单. 如果精确身份是稳定公开合同或安全合同的一部分, 规范仍可指明文件, 命令, 字段或结果.

如果产品提供命令行接口, 在适用的公开行为章节中定义一次其精确命令行合同, 不得在命令附录中复制它.

## Glossary removal

删除术语表条目时, 检查适用的 `CONTEXT-MAP.md`, 当前和历史 issue, 研究资料, ADR, 规范和审计证据, 找出仍把术语表当作决定权威的引用. 在实际负责仍然有效的决定的文档中保存该决定, 并在术语仍有用时在该文档中解释它.
<!-- arw:managed:end -->
<!-- arw:repository-owned:start -->
None.
<!-- arw:repository-owned:end -->
