<!-- arw:managed:start -->
# Spec Readiness 工作流

## Purpose

Spec Readiness 针对每个实施 issue 运行, 不针对 Application Source Issue 或 Wayfinder issue 运行. 它证明当前实施 issue 具有现行且经过独立审查的治理设计, 或仍然有效的明确例外. 实施授权, 阻断项和必要的用户设计决定仍由各自工作流判断.

## Authorization timing

已授权 issue 与已确认设计范围内的实施可以和首次就绪审核并行, 第一次实施写入不要求先取得成功的就绪结果. 缺失, 过期, `gap` 或 `uncertain` 结果阻断该 issue 的完成, Commit Audit 与提交授权, 不自动阻断不依赖该结果的已授权工作. 尚未确认的重要设计或其他实际前置结果仍须先解决, 并行允许不授予越界写入, 真实模型运行或发布验证权限.

在报告该 issue 完成前, 在以它授权的候选开始 Commit Audit 前, 以及在执行提交前, 分别对最终当前内容运行以下检查并取得退出码 `0`. 特定工作流明确需要更早的就绪结果时, 保留那项独立依赖.

```text
arw spec-readiness verify --issue issue:<NNNN>:<NN>
```

退出码含义如下:

- `0`: 只授权 Spec Readiness 这一项前提条件.
- `1`: 记录缺失, 格式错误, 已过期, 在语义上未满足, 或对该 issue 无效.
- `2`: 命令用法无效.

任何治理 Input 字节, Reviewer Role, 请求 subject 身份, 生成记录或就绪记录发生变化后, 旧结果不能授权新版本. 准备新的完整 `prepare -> review -> generate -> promote -> verify`, 按[公共复审规则](reviewer.md#review-changes-and-prior-coverage)处理相邻版本差异及历史覆盖, 并在上述时点取得当前有效结果. 不放宽字节和身份的新鲜度检查, 也不因完整生命周期必须重做就默认全盘语义重审.

与请求绑定的 subject 是连续的 `## What to build`, `## Spec Requirement` 和 `## Acceptance criteria` 范围. Reviewer Request 把行尾归一化为 LF 后, 保留其精确的当前内容. Markdown 围栏代码块中的二级标题仍是 subject 内容, 不会划分该范围.

仅在计算 subject 身份时, 对 `## Acceptance criteria` 内且 Markdown 围栏代码外的列表项开头的实际任务列表标记, 把 `[x]` 或 `[X]` 规范化为 `[ ]`. 只更改这些完成标记不会使就绪失效. 其他任何 subject 内容变更都会使它失效. `Status:`, `## Blocked by` 和 Commit Audit 记录不进入 subject; `## Validation` 和 `## Comments` 按[记录章节规则](issue-tracker.md#issue-record-sections)处理, 不成为治理要求.

## Requirement scope

Issue 的 `## Spec Requirement` 只列出该 issue 实际实现的要求. 只有当 effort 的存在目的就是实现长期规范时, 该规范才属于此范围. 如果修改长期规范是其他受治理工作的输出, 把该变更放入验收标准, 不得把发生变化的文档作为输入要求. 相关背景资料不会自动成为治理资料.

对特定章节的要求使用 `path#ascii-heading-anchor`. `path` 是相对于最近 Git 仓库根目录的归一化路径, 与 Input `filePath` 完全相同. 它永远不相对于 issue 目录. 只有符合以下条件的 Markdown 文档才允许使用仅含路径的治理引用: 没有 ATX 标题, 或恰好只有一个 H1 且没有其他 ATX 标题. 不得把本地跟踪器 issue 引用为治理 Input.

## Module Design applicability

Spec Readiness 针对每个实施 issue 运行, 不针对 Application Source Issue 或 Wayfinder issue 运行. Module Design 只影响实施工作流中的条件检查.

- 工作不修改非测试运行时代码时, 省略 `## Module Design`.
- 工作修改非测试运行时代码, 但不改变 Module 责任, Interface, Seam, 依赖方向, 权威来源或数据流时, 包含一个 `## Module Design`, 其完整内容是一个 `Not required:` 段落.
- 如果任何一项此类模块相关设计发生变化, 包含使用 `Modules`, `Interfaces`, `Seams and Adapters`, `Dependencies and Data Flow`, `Module Design Rationale` 和 `ADR Evaluation` 的完整 Module Design 格式. 其他方面完整, 但使用旧 `Design Rationale` 标题的现有输入仍然有效. 新建或已更改的格式使用 `Module Design Rationale`, 使 Module 理由与普通的 `Design Rationale` 职责明确区分.

根据正式运行时行为, 而不是目录, 文件扩展名或语言, 判断非测试运行时代码. 不得添加独立的适用性布尔值.

## Review workflow

处理准备, Reviewer 编排, 质疑处理和只含问题的草稿时, 读取 [请求准备和审查](spec-readiness-review-request.md). 处理生成, 提升, 问题处置, 正式检查, 证据和验证时, 读取 [Spec Readiness 结果生命周期](spec-readiness-result-lifecycle.md). 下方的例外工作流也使用该结果生命周期.

## Exception workflow

只有在应用治理设计和 ADR 触发条件, 并取得用户关于不需要治理设计的明确确认后, 才使用例外模式. Issue 必须精确使用 `Not required`.

Main Agent 写入现有的临时 JSON 例外草稿. 草稿只包含 `exception.reason` 和 UTC 秒级 `exception.confirmedAt`. 然后使用相同的 `generate -> promote -> verify` 边界. Engine 写入临时的模式版本 6 例外记录. 只有 `promote` 会写入与 issue 绑定的 `not-applicable` 记录.

例外草稿不使用 Reviewer JSONL 合同. 更早的记录结构已经过期. 不得推断确认, 也不得把失败的普通审查转换为例外.

## Reviewer boundary

ARW Engine 负责机械语法, 路径, 摘要值, 顺序, 生成, 提升, 持久化和新鲜度检查. 独立 Reviewer 判断本轮完整治理设计是否满足就绪要求, 并亲自将完整响应草稿写入请求指定的 `draftPath`. Reviewer 按 [单 Agent 执行与报告写入规则](reviewer.md#single-agent-execution) 独自完成审核, 不创建子 Agent 或协作文件. 与用户沟通的 Main Agent 按 [启动与控制 Reviewer 的操作步骤](reviewer.md#machine-operations) 提供完整请求和运行设置, 控制独立会话, 不通过自身原生子 Agent 槽位启动 Reviewer. Main Agent 只在 `ready` 后调用生成操作, 且只提升 ARW Engine 精确生成的记录, 不编辑其字节. Main Agent 不以自己的判断取代 Reviewer 结果.
<!-- arw:managed:end -->
<!-- arw:repository-owned:start -->
None.
<!-- arw:repository-owned:end -->
