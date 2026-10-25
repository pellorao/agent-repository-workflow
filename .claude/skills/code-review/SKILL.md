---
description: 沿实施标准和治理要求两个独立审查轴审核一个 Git 比较. 用于分支, 拉取请求, 提交区间和进行中的变更审查, 包括提交前对已暂存变更的审查.
name: code-review
---

# Code Review

沿两个独立审查轴审核一个完整的 Git 比较:

- **Standards**: 变更是否遵循适用的 Agent 指令和实施质量标准?
- **Spec**: 变更是否实现已提供的治理要求?

使用具名的 `code-standards-reviewer` 和 `code-spec-reviewer`. 对应的规范角色文档拥有审查准则和输出规则.

## Process

### 1. Require explicit governing requirements

要求调用方为 Spec 轴提供适用的治理要求输入. 接受仓库相对路径, 在任一审查轴启动前, 将每份来源路径, SHA-256 和完整内容保存在本轮绑定的临时副本中. 不发现其他 issue, spec, PRD 或 ADR.

Main Agent 按 [公共审查版本规则](../../../docs/agents/reviewer.md#review-versions-and-concurrency)固定适用的 Agent 指令. Standards Reviewer 按其规范角色读取这些完整的绑定副本. 它们是执行规则, 不是 Spec 治理输入; Standards 轴不要求调用方选择标准文档路径集合, 也不要求确认没有标准.

缺少治理要求输入时, 请用户提供, 或明确确认没有治理要求.

只有用户明确确认没有治理要求时, 才跳过 Spec Reviewer 并使用以下精确结果:

```text
Not reviewed: no governing requirements were supplied.
```

Gate 2 与是否跳过 Spec Reviewer 相互独立. 它的适用性, 治理要求并集和例外规则不能证明 Spec 审查没有必要.

调用方应已提供 issue 跟踪规则. 如果缺少 `docs/agents/issue-tracker.md`, 运行只读的 `arw workflow verify`. 如果验证表明仓库尚未初始化, 告知用户另行运行 `arw workflow init`. 此检查只验证仓库工作流设置, 不发现或提供审查输入.

调用本技能前, Main Agent 必须确定预期仓库范围并准备 Git 索引. 本技能消费已经形成的比较, 不暂存或取消暂存文件. Main Agent 已经准备的范围不增加第二次用户确认关卡.

### 2. Verify the prepared review candidate

对于提交 Gate 3, 调用方提供固定的已暂存实施候选, 不包含本次 Gate 1 或 Gate 2 输出. 本技能不运行或要求 `arw commit-audit verify`; 提交工作流可让同候选 Commit Audit 与适用代码轴并行, 最终提交仍等待全部适用结果. 分支, 拉取请求或其他普通比较没有 Commit Audit 前提.

只有预期比较及第 1 步的治理输入或确认已经齐备时才继续. 阅读[结论复用](result-reuse.md)按轴判断已有结果, 更新完成记录前也读取它. 复用有效结果并进入第 5 步; 需要新判断时说明实际变化, 安排受影响的就绪及验证, 只对受影响轴交接完整固定比较, 按公共复审规则取得完整当前结果. Code Review 可与就绪及适用 Commit Audit 并行, 各自开始条件和最终授权时点由所属工作流拥有. 未完成结果不提供通过事实. 本循环不生成, 提升或消费 Gate 1 或 Gate 2 记录.

### 3. Resolve the comparison

使用以下两种模式之一.

#### Default workspace mode

用户未提供比较边界时:

- 只解析一次 `HEAD`, 将它作为起点提交.
- 由 Main Agent 使用 `git write-tree` 固定一次已经准备的索引, 并记录返回的树对象作为终点. 这项 Git 写入仍由 Main Agent 独占负责.
- 使用 `git diff <actual-start> <captured-tree> --name-only -z` 建立变更路径集合.
- 从固定的树对象读取已暂存新增项的完整内容.
- 不包含未暂存或未跟踪内容.

调用方提供了任一比较边界时, 阅读 [显式 Git 范围](explicit-range.md), 不使用默认工作区模式.

无论默认暂存模式还是显式 Git 范围, 比较基线只解析一次, 完整变更路径集合也只建立一次. 启动 Reviewer 前, 将引用解析为不可变对象身份. 在下一条用户可见的范围说明中, 陈述请求的边界, 实际起点提交和固定的终点身份. 默认工作区模式的实际起点是已解析的 `HEAD` 提交.

读取差异内容前, 对完整集合执行一次路径选择. 存在 `.arwignore` 时, 按顺序应用其 `.gitignore` 风格规则, 包括后续重新纳入的规则. 然后仅排除每个 effort 目录下精确符合仓库相对形式 `.scratch/<NNNN>-<effort-slug>/prototype/**` 和 `.scratch/<NNNN>-<effort-slug>/research/**` 的路径. 这些结构排除不匹配相近名称, `.scratch` 之外的路径或 effort 根目录下的其他内容. 不把这两项排除添加到 `.arwignore`.

保留变更路径集合的原始顺序, 不排序或去重. 构建 Reviewer 命令或文件列表前移除已排除路径. Reviewer 不得接收或读取已排除的差异内容.

比较使用只读 Git 命令, 限定到纳入范围的路径. 适用时交接已解析提交区间的提交列表. 暂存终点使用 `git diff <actual-start> <captured-tree> -- <included-paths>`. 使用 `git show <captured-tree>:<path>` 读取必要文件全文及关联实现; 提交终点则使用已解析的提交身份. 已删除文件与相关的先前行为从已解析的起点提交读取. 读取关联上下文时保留纳入路径和排除范围限制. 单份差异快照不足以提供完整上下文, Reviewer 不得读取正在变化的工作区文件来补足缺口.

建立一份比较说明, 包含固定基线与终点, 只读 Git 命令, 纳入路径, 提交区间及绑定要求和 Agent 指令. 把同一版本交给需要新判断的 Reviewer, 保留另一轴完整有效结果; 不让 Reviewer 再次解析或过滤比较.

下一条用户可见的范围说明只列纳入的路径. 不列已排除, 未暂存, 未跟踪路径或选择前后的路径集合. 没有纳入路径时, 报告没有可审查变更并停止; 否则让每个适用轴审核纳入的比较.

任何 Git 读取, 比较解析或过滤步骤失败时, 将审查标为不完整, 在创建任一 Reviewer 前停止. 这些 Gate 3 过滤不改变 Agent 管理的范围. 后续 Commit Audit 仍检查已经批准的完整已暂存实施候选, 不被本过滤缩小.

完成条件: 需要新判断的轴收到同一份完整不可变比较, 未受影响的轴已有完整有效结果, 且没有重复比较解析或过滤工作.

### 4. Run both axes independently

Reviewer 身份由审查轴固定的 `input.role` 值和完整排序的授权 issue ID 集合组成. Standards 使用 `code-standards-reviewer`, Spec 使用 `code-spec-reviewer`. 解析既有身份, 处理报告的问题或准备后续审核前, 阅读 [后续审核与问题处理](reviewer-followup.md).

为每个轴的每轮审查, 在受审仓库的当前会话临时工作区内分配不同的绝对 `resultPath`, 并创建空文件. 将准确路径交给 Reviewer; 只有 Reviewer 写入其内容. 不把上一轮报告复用为新草稿.

任一轴启动前绑定完整审查版本, Git 对象和临时副本保持不变. 源工作树可在授权内继续变化; 有依赖实时索引的 Commit Audit 时保持其索引和 HEAD 固定. 按 [Reviewer 机器操作](../../../docs/agents/reviewer.md#machine-operations), 通过共享独立 Codex App Server 并行运行需要新判断的轴. `input.role` 分别为 `code-standards-reviewer` 和 `code-spec-reviewer`; `handoff` 交接该轴完整输入, 后续再按公共复审规则交接自身前轮材料, `reportPath` 使用准确 `resultPath`. Main Agent 提供完整绑定角色与公共指令, 受审仓库 `cwd` 和获准临时写入范围, 模型设置及读写路径遵循共同入口. 首次不继承父会话, 不发送作者讨论, 隐藏推理或倾向性结论. Reviewer 独自完成当前判断并亲自写完整报告, 并行修改不替换本轮版本或自动授权新候选.

每次调用接收:

- 使用具名 Reviewer 时, 对应的规范角色路径.
- 不可变比较身份, 只读 Git 命令和适用提交区间.
- 完整的纳入路径集合.
- 适用验证事实, 准确标识尚未完成的检查.
- 完整绑定的适用 Agent 指令及其来源路径和 SHA-256 映射.
- 仅 Spec 轴接收完整治理要求副本及其来源路径和 SHA-256 记录.
- 准确绑定的 `resultPath` 和只交付结果的指令.

不在 Reviewer 提示中重复规范角色的审查准则.

完成条件: 每个需要新判断的轴以 `{"status":"ready"}` 确认完整交付或明确不可用, 未重跑的适用轴具有完整有效通过结果, 本轮输入保持不变. 只有完整交付后才把新报告作为结果读取. 缺失, 不可读或空文件不证明成功, Main Agent 不重建替代报告.

### 5. Aggregate without reranking

先呈现已解析的范围. 包含请求的边界和实际起点, 然后只列交给 Reviewer 的路径.

在 `## Standards` 和 `## Spec` 下呈现结果. 从绑定报告文件读取并保留每个成功轴的结果, 不合并, 改写, 跨轴重新排序, 也不让一个轴抵消另一个轴. 报告文件是结果权威, Reviewer 的最终消息只确认完成.

Main Agent 可以另附面向用户的通俗解释, 上述原报告与结果格式保持不变.

必需轴失败时, 保留成功轴的结果并使用:

```text
Review unavailable: <reason>.
```

将整体审查标为 `incomplete`. 失败轴不能显示 `No findings.`. 用户确认没有治理要求时, 使用第 1 步精确规定的未审查结果, 不声称符合 Spec.

完成条件: 报告标识准确比较与 Reviewer 路径集合, 每个适用轴都有独立结果, 并准确说明完整或不完整状态.
