---
description: 为实施 issue 安排和完成 Spec Readiness 独立设计审核: 准备 Request, 启动 Reviewer, 生成, 提升和验证就绪记录, 处理问题, 质疑和例外. spec 和 issue 设计定稿, 或设计修正后需要复审时使用.
name: spec-readiness
---

# Spec Readiness

Spec Readiness 针对每个实施 issue 运行 (交付只含非实施分类内容, 或按行为保持重构例外实施的除外, 见 `implement` 与 `commit` Skill), 不针对 Application Source Issue 或 Wayfinder issue. 它证明该 issue 具有当前且经过独立审查的治理设计, 或仍然有效的明确例外. 实施授权, 阻断项和用户设计决定仍由各自工作流判断.

## Authorization timing

- Spec Readiness 在 spec 和 issue 设计定稿时审核一次, 不在报告完成或提交审核时重复. 首次修改本 issue 的实现文件前 (行为保持重构例外的 issue 除外) 须取得 `satisfied` 或例外记录 (`implement` Skill 的 Entry 检查完整 `verify`; 例外记录可以按 Exception workflow 节补生成). 记录只授权开始实施; 开始实施后的设计改动由提交审核核对.
- 不通过时修正后复审: 重新执行 `prepare -> review -> generate -> promote`, Reviewer 按 `docs/agents/reviewer.md` 的 Re-review 节只看改动部分及其影响范围. 开始实施前, 治理 Input 字节, Reviewer Role 或 subject 变化后旧记录不授权新版本, 须做增量复审, 不由 Main Agent 自行判断改动是否相关. `architecture-evidence` 是 issue 本身会修改的实现事实, 不受字节检查.
- 已开始实施后, 提交审核提出的只涉及措辞, 重复或一致性 (不改变范围, 行为或验收含义) 的问题不修改 subject: 在 issue 的 `## Comments` 记录处置, 由提交审核的要求符合审核对照 spec 与实现核对, 不重跑本工作流. 改变范围, 行为或验收含义的真实变化仍修改 subject 并做增量复审. 判断由 Main Agent 作出, 拿不准时按真实变化处理.
- "已开始实施" 只按规则判断, 不由引擎判断: 当前分支已有本 issue 授权的实施提交, 或工作树已有本 issue 的实现改动. 已开始实施后 Input 与 Reviewer Role 的字节变化不再阻断, 中断后恢复实施也不重跑完整 `verify`. 实现文件指该 issue 交付的所有已跟踪文件 (代码, 测试, 文档, 规则, 含它的治理 Input), 不含 `.scratch` 中该 issue 的 issue 文件与就绪记录.
- `arw spec-readiness verify --issue issue:<NNNN>:<NN>` 在开始实施前运行完整核对 (补生成的例外记录在生成后运行); 实施提交前 (含让 issue 进入终态的收尾提交; 行为保持重构例外的 issue 除外) 运行 `verify --subject-only`, 只核对 subject; 除实施提交外不为收尾或已完成的 issue 另行验证. 都必须取得退出码 `0`; `1` 表示记录缺失, 格式错误, 过期, 语义未满足或对该 issue 无效, `2` 表示命令用法无效. 缺失, 过期或 `gap` 结果阻断实施和提交, 不阻断不依赖该结果的其他工作.

## Subject

subject 是连续的 `## What to build` 到 `## Acceptance criteria` 范围, 行尾归一化为 LF; Markdown 围栏代码块内的二级标题属于正文, 不划分范围. 计算 subject 身份时, 只把 `## Acceptance criteria` 内, 围栏代码之外, 列表项开头的任务标记 `[x]` 或 `[X]` 规范化为 `[ ]`, 所以只勾选验收项不会使就绪失效; 其他 subject 内容变化都会使它失效. `Status:`, `## Blocked by`, `## Validation`, `## Comments` 和 Commit Audit 记录不属于 subject.

## Governing design

issue 不列治理要求引用: Reviewer 根据 `## What to build` 在 `docs/specs`, `docs/adr` 和本 effort 的 spec 中自行检索该 issue 实现的既有章节 (检索结果不是 Input), Main Agent 不提供锚点. Module Design 只影响实施工作流中的条件检查, 按正式运行时行为而不是目录, 扩展名或语言判断, 不添加独立的适用性布尔值:

- 工作不修改非测试运行时代码时, 治理 spec 或 PRD 省略 `## Module Design`.
- 修改非测试运行时代码, 但不改变 Module 责任, Interface (包括已有字段所表示含义的改变), Seam, 依赖方向, 权威来源或数据流时, 包含一个完整内容只是一个 `Not required:` 段落的 `## Module Design`.
- 任何一项此类设计变化时, 使用完整格式: `Modules`, `Interfaces`, `Seams and Adapters`, `Dependencies and Data Flow`, `Module Design Rationale` 和 `ADR Evaluation`. 使用旧 `Design Rationale` 标题但其他方面完整的现有输入仍然有效; 新建或修改的格式使用 `Module Design Rationale`.

## Prepare and review

1. 准备 Input 对象: 非空的 `inputs` 数组, 每项是 `role` 和仓库相对的 `filePath`. 至少包含一个 `governing-spec` 或 `governing-prd`, 以及每个适用的 `adr`, `domain-context` (每个适用的上下文文档) 和 `architecture-evidence` (已有的必要实现事实). 每个 Input 准备时必须已经存在, 并且是本轮权威设计或必要证据, 不用尚未创建的内容代替. Agent 指令, Reviewer Role, 平台 Agent 配置和本地跟踪器 issue 永远不是 Input; 不推断省略的 Input, 也不加入无关的术语表或决定.
2. `prepare` 前自检 (多数重复复审问题都能由此提前发现): `What to build` 与验收标准中的命令, 字段和行为名称都能 grep 到 (`path:line` 越界, 不存在的路径和缺观察方式的验收项由 `prepare` 的 stderr `warning:` 行报告, 逐条处理); subject 与 spec 对同一命令, 字段, 规则的表述一致 (改过一处就 grep 另一处旧写法); 声明的每项责任或规则都有 Interface 条目 (输入, 输出, 错误和重复, 缺失分支的结果); 设计依赖的外部事实 (运行时输出形状, 冻结补丁, 他处规格) 已在 Input 中; spec 与 issue 写明的每个失败, 拒绝和边界结果, 测试段都有对应观察; `ADR Evaluation` 逐项列出本次改变的权威来源, 持久状态和恢复合同.
3. 运行 `arw spec-readiness prepare --issue issue:<NNNN>:<NN>`, Input 对象从标准输入传入, 或用 `--input <temp-json-path>`. 它冻结 subject, 创建不可变的 Reviewer Request, 在 issue 工作区写出审核轮目录 `rounds/<requestId>/` (空草稿 `report/draft.txt`, subject 与 Input 快照, 规则副本和 `.jsonl` 请求; 复审时另有两轮快照差异 `changes.diff`), 只打印轮目录. 后续 `prepare` 使较早的请求失去生成和提升资格.
4. 按 `../reviewer-launch/SKILL.md` 的 Review rounds 节运行本轮 Reviewer. 运行中的 Request 及其快照保持不变, 修正后的版本重新 `prepare`. 只有 Reviewer 返回最终 `ready` 后才把草稿当作完整结果; 草稿格式由 `docs/agents/roles/spec-readiness-reviewer.md` 的 Output 节定义.

## Generate, promote and verify

- Reviewer 返回 `ready` 后运行 `arw spec-readiness generate --issue issue:<NNNN>:<NN> --input <轮目录>/report/draft.txt`. Engine 拒绝其他路径和空草稿; 草稿精确为 `No problems.` 时记为 `satisfied`, 否则记为 `gap`. 它在当前 issue 工作区写入模式版本 7 记录并只打印其路径. 生成本身不授权实施. Main Agent 每轮自选一两处 Reviewer 应当检查的要求或代码位置抽查; 发现漏检时该轮结果作废并重审.
- 运行 `arw spec-readiness promote --input <generated-path>`, 传入精确生成路径, 不编辑其字节. 它是写入 `.scratch/<NNNN>-<effort-slug>/issues/<NN>.spec-readiness.json` 的唯一边界, 写入前重新验证请求, subject, Input 字节, Reviewer Role 和派生结果; 任何失败都保留先前记录. 有效的 `gap` 记录可以作为诊断结果提升, 但不满足授权.
- 按 Authorization timing 节运行 `verify`. 只有模式版本 7 记录有效; 更早版本和 effort 根目录的 `spec-readiness.json` 只是历史记录, Engine 不读取, 不迁移也不删除它们.

## Respond to findings

Main Agent 在修改 issue 前独立验证每个问题. 问题有效时修正设计或 issue: 要求修改 spec 或 PRD 的问题按 `../rule-and-design-changes/SKILL.md` 的 Reviewer-proposed changes 节由 Main Agent 与独立 subagent 共同决定, 只有分歧交用户. 然后对新内容执行完整工作流 (已开始实施后的措辞, 重复或一致性问题按 Authorization timing 节只记录不改 subject). 按 `docs/agents/subagent-findings.md` 的 Triage by origin 节属于既有缺口的问题记入后续 issue, 并按下段质疑, 理由是本次交付不引入, 不改变也不依赖该缺口; Reviewer 指出交付对缺失事实的具体依赖而保留它时, 它不是既有缺口, 按本次影响的问题修正; 提交审核只修改代码时就绪记录仍有效, 不重跑.

结果符合 `docs/agents/subagent-findings.md` 的质疑条件时, 用未变的 subject 和 Input 重新 `prepare`, 通过 `followup_task` 把新请求, 每个受质疑问题的具体证据和推理错误交给原 Reviewer. 质疑消息只是提示, 不是 Input, 证据或授权. 有争议的结果在替代结果完成 `generate -> promote` 前继续阻断提交. subject 或 Input 已改变时改用普通的新请求.

## Exception workflow

只有应用治理设计和 ADR 触发条件, 并取得用户关于不需要治理设计的明确确认后, 才使用例外. Main Agent 写入临时 JSON 例外草稿, 只包含 `exception.reason` 和 UTC 秒级 `exception.confirmedAt`, 然后执行同样的 `generate -> promote -> verify`; 只有 `promote` 写入与 issue 绑定的 `not-applicable` 记录. 例外不使用 Reviewer 报告. 不得推断确认, 也不得把失败的普通审查转为例外. 用户确认须早于首次修改本 issue 的实现文件; `exception.confirmedAt` 写用户作出确认的时间 (用户事先对一类 issue 作出的常设确认, 写该常设确认作出的时间), 不写生成时间. 满足这一条件时, 例外记录可以在实施开始后补生成, 在实施提交前完成上述流程, 因为例外不经 Reviewer, 记录内容与生成时机无关.

## Responsibilities

ARW Engine 负责语法, 路径, 摘要值, 顺序, 生成, 提升, 持久化和新鲜度检查. 独立 Reviewer 判断本轮治理设计是否就绪, 并亲自写入完整草稿. Main Agent 提供完整请求, 控制独立会话, 只提升 Engine 精确生成的记录, 不以自己的判断取代 Reviewer 结果.
