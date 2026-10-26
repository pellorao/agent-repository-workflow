---
description: 为实施 issue 安排和完成 Spec Readiness 独立设计审核: 准备 Request, 启动 Reviewer, 生成, 提升和验证就绪记录, 处理问题, 质疑和例外. spec 和 issue 设计定稿, 或设计修正后需要复审时使用.
name: spec-readiness
---

# Spec Readiness

Spec Readiness 针对每个实施 issue 运行, 不针对 Application Source Issue 或 Wayfinder issue. 它证明该 issue 具有当前且经过独立审查的治理设计, 或仍然有效的明确例外. 实施授权, 阻断项和用户设计决定仍由各自工作流判断.

## Authorization timing

- Spec Readiness 在 spec 和 issue 设计定稿时审核一次, 不在报告完成或提交审核时重复. 修改实现文件前须取得 `satisfied` 或例外记录 (`implement` Skill 的 Entry 检查 `verify`).
- 不通过时修正后复审: 重新执行 `prepare -> review -> generate -> promote`, Reviewer 按 [复审规则](../../../docs/agents/reviewer.md#re-review) 只看改动部分及其影响范围. 治理 Input 字节, Reviewer Role 或 subject 变化后旧记录不授权新版本, 新鲜度检查不放宽. `architecture-evidence` 是 issue 本身会修改的实现事实, 不受新鲜度检查: 实施改动它不需要复审.
- `arw spec-readiness verify --issue issue:<NNNN>:<NN>` 在开始实施前和提交前运行, 必须取得退出码 `0`; `1` 表示记录缺失, 格式错误, 过期, 语义未满足或对该 issue 无效, `2` 表示命令用法无效. 缺失, 过期或 `gap` 结果阻断实施和提交, 不阻断不依赖该结果的其他工作.

## Subject

subject 是连续的 `## What to build`, `## Spec Requirement` 和 `## Acceptance criteria` 范围, 行尾归一化为 LF; Markdown 围栏代码块内的二级标题属于正文, 不划分范围. 计算 subject 身份时, 只把 `## Acceptance criteria` 内, 围栏代码之外, 列表项开头的任务标记 `[x]` 或 `[X]` 规范化为 `[ ]`, 所以只勾选验收项不会使就绪失效; 其他 subject 内容变化都会使它失效. `Status:`, `## Blocked by`, `## Validation`, `## Comments` 和 Commit Audit 记录不属于 subject.

## Governing design

`## Spec Requirement` 的格式和范围见 [Issue requirements](../issue-tracking/SKILL.md#issue-requirements). Module Design 只影响实施工作流中的条件检查, 按正式运行时行为而不是目录, 扩展名或语言判断, 不添加独立的适用性布尔值:

- 工作不修改非测试运行时代码时, 治理 spec 或 PRD 省略 `## Module Design`.
- 修改非测试运行时代码, 但不改变 Module 责任, Interface, Seam, 依赖方向, 权威来源或数据流时, 包含一个完整内容只是一个 `Not required:` 段落的 `## Module Design`.
- 任何一项此类设计变化时, 使用完整格式: `Modules`, `Interfaces`, `Seams and Adapters`, `Dependencies and Data Flow`, `Module Design Rationale` 和 `ADR Evaluation`. 使用旧 `Design Rationale` 标题但其他方面完整的现有输入仍然有效; 新建或修改的格式使用 `Module Design Rationale`.

## Prepare and review

1. 准备 Input 对象: 非空的 `inputs` 数组, 每项是 `role` 和仓库相对的 `filePath`. 至少包含一个 `governing-spec` 或 `governing-prd`, 以及每个适用的 `adr`, `domain-context` (每个适用的上下文文档) 和 `architecture-evidence` (已有的必要实现事实). 每个 Input 准备时必须已经存在, 并且是本轮权威设计或必要证据, 不用尚未创建的内容代替. Agent 指令, Reviewer Role, 平台 Agent 配置和本地跟踪器 issue 永远不是 Input; 不推断省略的 Input, 也不加入无关的术语表或决定.
2. 运行 `arw spec-readiness prepare --issue issue:<NNNN>:<NN>`, Input 对象从标准输入传入, 或用 `--input <temp-json-path>`. 它冻结 subject, 创建不可变的 Reviewer Request, 在 issue 工作区写出审核轮目录 `rounds/<requestId>/` (空草稿 `report/draft.txt`, subject 与 Input 快照, 规则副本和 `.jsonl` 请求; 复审时另有两轮快照差异 `changes.diff`), 只打印轮目录. 后续 `prepare` 使较早的请求失去生成和提升资格.
3. 按 `reviewer-launch` 的 [审核轮](../reviewer-launch/SKILL.md#review-rounds) 运行本轮 Reviewer. 运行中的 Request 及其快照保持不变, 修正后的版本重新 `prepare`. 只有 Reviewer 返回最终 `ready` 后才把草稿当作完整结果; 草稿格式由 [角色输出规则](../../../docs/agents/roles/spec-readiness-reviewer.md#output) 定义.

## Generate, promote and verify

- Reviewer 返回 `ready` 后运行 `arw spec-readiness generate --issue issue:<NNNN>:<NN> --input <轮目录>/report/draft.txt`. Engine 拒绝其他路径和空草稿; 草稿精确为 `No problems.` 时记为 `satisfied`, 否则记为 `gap`. 它在当前 issue 工作区写入模式版本 7 记录并只打印其路径. 生成本身不授权实施. Main Agent 每轮自选一两处 Reviewer 应当检查的要求或代码位置抽查; 发现漏检时该轮结果作废并重审.
- 运行 `arw spec-readiness promote --input <generated-path>`, 传入精确生成路径, 不编辑其字节. 它是写入 `.scratch/<NNNN>-<effort-slug>/issues/<NN>.spec-readiness.json` 的唯一边界, 写入前重新验证请求, subject, Input 字节, Reviewer Role 和派生结果; 任何失败都保留先前记录. 有效的 `gap` 记录可以作为诊断结果提升, 但不满足授权.
- 按 [授权时点](#authorization-timing) 运行 `verify`. 只有模式版本 7 记录有效; 更早版本和 effort 根目录的 `spec-readiness.json` 只是历史记录, Engine 不读取, 不迁移也不删除它们.

## Respond to findings

Main Agent 在修改 issue 前独立验证每个问题. 问题有效时修正设计或 `## Spec Requirement`: 要求修改 spec 或 PRD 的问题按 `rule-and-design-changes` Skill 的 [Reviewer-proposed changes](../rule-and-design-changes/SKILL.md#reviewer-proposed-changes) 由 Main Agent 与独立 subagent 共同决定, 只有分歧交用户. 然后对新内容执行完整工作流.

结果符合 `docs/agents/subagent-findings.md` 的质疑条件时, 用未变的 subject 和 Input 重新 `prepare`, 通过 `followup_task` 把新请求, 每个受质疑问题的具体证据和推理错误交给原 Reviewer. 质疑消息只是提示, 不是 Input, 证据或授权. 有争议的结果在替代结果完成 `generate -> promote` 前继续阻断提交. subject 或 Input 已改变时改用普通的新请求.

## Exception workflow

只有应用治理设计和 ADR 触发条件, 并取得用户关于不需要治理设计的明确确认后, 才使用例外; issue 精确使用 `Not required`. Main Agent 写入临时 JSON 例外草稿, 只包含 `exception.reason` 和 UTC 秒级 `exception.confirmedAt`, 然后执行同样的 `generate -> promote -> verify`; 只有 `promote` 写入与 issue 绑定的 `not-applicable` 记录. 例外不使用 Reviewer 报告. 不得推断确认, 也不得把失败的普通审查转为例外.

## Responsibilities

ARW Engine 负责语法, 路径, 摘要值, 顺序, 生成, 提升, 持久化和新鲜度检查. 独立 Reviewer 判断本轮治理设计是否就绪, 并亲自写入完整草稿. Main Agent 提供完整请求, 控制独立会话, 只提升 Engine 精确生成的记录, 不以自己的判断取代 Reviewer 结果.
