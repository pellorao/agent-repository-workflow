# Gate 2 增量审核与删除 Spec Requirement

## Problem Statement

提交审核的 Gate 2 在 effort 的所有 issue 进入终态时,把 issue `## Spec Requirement` 列出的整份治理文档交给 Reviewer 全量审核. 这带来三个问题:

1. 全量审核成本随文档体积增长. 例如一个只改了几行代码的 effort,其引用的 3 份主规格合计约 428 KB,单个 Reviewer 无法认真读完,审核结果不可靠.
2. 每个 effort 都从头审同一批未变化的文档,旧缺口反复冒出,与本 effort 无关的问题阻塞提交.
3. `## Spec Requirement` 要求 Main Agent 在每个 issue 中手工选择治理要求并写成机械校验的引用列表. 选择错误是就绪审核最常见的缺口来源,而校验链(Spec Readiness 资格检查,Commit Audit 并集,迁移路径改写,软锁)占用了大量代码和文档.

## Solution

最终状态如下.

- 每次实施提交的要求符合审核做两件事: Gate 1(每个新进入终态的 issue 对照其 `## What to build` 和验收标准),以及差异回归检查(从代码差异出发,检索相关既有要求,核对它们在受审版本中仍然成立).
- Gate 2 只审核治理文档的改动: `docs/specs/**/*.md`,`docs/adr/*.md` 和本 effort 的 `spec.md`,`PRD.md` 在 `git diff <since> <tree>` 中的差异. `since` 是 effort 起点,由引擎从 Git 历史推导,不存储基线. 差异为空时没有需要审核的内容,不需要例外. 删除 `gate2Exception` 和"并集文档未改动即跳过 Gate 2"的例外.
- 删除 issue 的 `## Spec Requirement` 章节及所有读取,校验和要求写入它的规则,模板和文档. 实施 issue 的 subject 改为 `## What to build` 与 `## Acceptance criteria` 及其后到下一个二级标题之前的内容. `What to build` 仍可引用 spec 锚点,但不做机械校验.
- Spec Readiness Reviewer 不再依据 issue 选择的引用判断范围,而是自行检索与 `What to build` 和验收标准相关的既有章节. 它的审核范围是: 各 Input 自 `since` 起的改动,本 effort 的 spec,以及它检索到的相关章节. Main 不提供锚点.
- 从未全量审核过的旧文档(如早期 ADR)按现状接受,不单独补审.
- 已有 issue 不迁移. 带有 `## Spec Requirement` 的旧 issue 仍可读取,该章节落在 subject 内,不被解析.

## Implementation Decisions

### Effort 起点 `since`

`since` 由 `lib/arw-common` 中一个函数派生,Commit Audit 与 Spec Readiness 共用. 规则:

1. 在 HEAD 历史中找出最早修改 `.scratch/<NNNN>-*/` 下任意文件的提交(`NNNN` 是 effort 编号).
2. 该提交有父提交时,`since` 是其父提交;该提交是根提交时,`since` 是空树对象.
3. 历史中没有这样的提交(effort 尚未提交)时,`since` 是调用方传入的 `base`(HEAD).

不存储基线. 并行 effort 各自有起点,区间可重叠,重叠只会使同一改动被多个 effort 审核,不会让某个 effort 漏审其区间内的改动.

### Commit Audit

- `input.json` 删除 `gate2Exception`. `authorizingIssueIds` 不变.
- Request 的 `gate2` 在 effort 全部 issue 进入终态时是 `{since, documents}`,否则为 `null`. `documents` 是 `git diff --name-only <since> <tree>` 中属于治理文档路径的文件,可以为空.
- Reviewer 对 `documents` 中每份文档运行 `git diff <since> <tree> -- <path>` 并逐块核对. 为空时 Gate 2 没有审核内容.
- 差异回归: 结果只以问题的形式出现在 Reviewer 报告中,不要求覆盖清单,Engine 不解析报告. 对 `git diff <base> <tree>` 中 `tests/` 和 Markdown 以外的每个改动文件,列出改动涉及的导出名,命令与参数,诊断码,配置键,文件路径和用户可见文本,用检索工具在 `docs/specs`,`docs/adr` 和本 effort 的 spec 中找命中处,读取命中所在章节并核对要求仍成立. Reviewer 每个文件都完成检索,无命中不跳过.
- `since` 为空树时(effort 目录在根提交中),`git diff <since> <tree>` 仍然有效.

### Spec Readiness

- Reviewer Request 新增 `since` 字段(`requestDigest` 覆盖它,Reviewer 的唯一语义输入仍是 Request). `prepare` 调用起点推导取得它. Reviewer 用 `git show <since>:<filePath>` 取得 Input 在起点的内容,与 Request 中固定的 Input 快照比较,得到 Input 自起点的改动;该文件在起点不存在(新文件,或 `since` 为空树)时整份视为新增. 比较对象是快照而不是 HEAD,所以尚未提交的 Input 改动也在范围内,审核期间 HEAD 移动不影响结果.
- Reviewer 自行检索相关既有章节: 以 `What to build` 与验收标准中出现的命令,字段,模块和行为名称为线索,在 `docs/specs`,`docs/adr` 和本 effort 的 spec 中检索,读取命中所在章节作为比较证据. 检索结果是 Reviewer 的判断依据而不是绑定输入,不进入新鲜度摘要,也不产生记录. 这一检索读取工作树当前内容,是对公共规则(`docs/agents/reviewer.md` 中 Reviewer 只读固定版本)的显式例外,例外写进该规则句和 `spec-readiness-reviewer` 角色,仅限 Spec Readiness 检索相关既有章节; Input 快照,subject 和 Commit Audit 的 `base`/`tree` 仍是固定版本. 审核期间被检索章节可能变化而结论仍以固定的审核轮身份出现,这是被接受的代价(见 `Module Design Rationale`): 检索章节只作比较证据,Reviewer 在报告的问题中引用路径与标题.
- 删除 `validateRequirementEligibility`,issue 的要求解析,`verify` 与 `promote` 中的要求种类检查和"引用必须是已审 Input"检查. 就绪例外只由记录本身(用户确认的 `reason` 与 `confirmedAt`)承载,issue 不再写 `Not required`.
- Input 清单,新鲜度(按 Input 整份文件摘要)和 Reviewer 角色绑定不变.

### Issue 解析

`readIssueRequirement` 改名 `readIssueSubject`,只要求 `## What to build` 和 `## Acceptance criteria` 各出现一次(围栏外)且前者在先;subject 从 `## What to build` 开始,到 `## Acceptance criteria` 之后的下一个二级标题之前. 返回 `subjectContent` 与 `subjectIdentityContent`. Module 修正软锁名单去掉 `Spec Requirement`.

### Artifact 迁移

删除 `rewriteStructuredRequirementPaths` 及"活动 issue 必须先手写 `## Spec Requirement`"的诊断.

### Reviewer 能力场景

`spec-readiness-reviewer/runtime-migration` 删除 3 个专测"要求选择"的用例(2 个问题用例,1 个正例),保留其余. 不重新登记能力基线.

## Module Design

### Modules

- **Effort 起点推导**(`lib/arw-common/`): 新增. 给定 effort 编号,HEAD 和 Git 运行器,返回 `since`. 隐藏历史检索方式和根提交处理. 不负责决定哪些文档需要审核.
- **Commit Audit**(`lib/commit-audit/`): 在 `prepare` 中调用起点推导,按差异列出 Gate 2 文档. 不再解析 issue 要求,不持有例外.
- **Spec Readiness**(`lib/spec-readiness/`): 只负责 Input 快照,subject 冻结,Request 与记录;不再解析或校验 issue 中的要求选择. `prepare` 调用起点推导把 `since` 写入 Request.
- **Issue 文档解析**(`lib/arw-common/issue-documents.mjs`): 负责 subject 范围和身份内容. 不再负责要求列表.

### Interfaces

- `deriveEffortStart({git, effortNumber, base})` 返回字符串对象名: 父提交 SHA,空树 SHA 或 `base`. 参数来自程序自己,不再校验. Git 命令失败时抛出带 Git 错误输出的错误,`prepare` 不写出任何审核轮目录或 Request,CLI 打印原因并以非零退出;修复 Git 状态后重新 `prepare`.
- Commit Audit Request 的 `gate2` 变为 `{since: string, documents: string[]} | null`. `input.json` 含 `gate2Exception` 时按未知键拒绝.
- `readIssueSubject({issuePath, text})` 返回 `{subjectContent, subjectIdentityContent}`;缺失或重复的 `## What to build` 与 `## Acceptance criteria`,或顺序颠倒时抛出错误. `## Spec Requirement` 不是已识别章节.
- Spec Readiness Reviewer Request 增加 `since: string`,位于 `requestDigest` 覆盖的载荷中;读取已存储 Request 时缺少或多出键被拒绝. Request 位于会话工作区,只在一轮 `prepare` 到 `promote` 之间使用;`verify` 只读已提升的记录(模式版本 7 的记录含 `request.digest`,`request.filePath`,`request.id`,`reviewerRole`,`inputs` 的路径,角色和摘要,`subject` 和 `result`;`verify` 不打开 Request 文件,本变化不改记录的这些字段),所以已提升的就绪记录不受 Request 结构变化影响,仍按 Input,Reviewer Role 与 subject 的字节判断新鲜度. 进行中的旧 Request(缺少 `since`)不能被读取,重新 `prepare` 即可. 其余 `prepare`,`generate`,`promote` 和 `verify` 命令行入口不变;`verify` 不再因 issue 缺少或多出 `## Spec Requirement` 而失败. 例外记录继续由 `generate` 的 `exception` 草稿写出.

### Seams and Adapters

起点推导和 Commit Audit 通过现有 `createNodeGitRunner` 访问 Git,测试用真实临时 Git 仓库观察新 effort,已有历史,根提交三种情形;不新增 Seam.

### Dependencies and Data Flow

Commit Audit 与 Spec Readiness 依赖起点推导,起点推导依赖 Git 运行器. 起点推导没有状态,每次从 Git 历史派生,Git 历史是唯一的权威来源. 数据流: Main 暂存候选 -> `prepare` 派生 `since` 并写入 Request(两个工作流都在 Request 中) -> Reviewer 用 `git diff`(Commit Audit)或 `git show <since>:<path>` 与快照比较(Spec Readiness)读取差异. `since` 作为字段保存在会话工作区(`.tmp`,不被 Git 跟踪)的 Request 中,不是权威来源(权威是 Git 历史),每次 `prepare` 重新派生. 提交点是 Commit Audit 的 `verify`,它仍只核对最新审核轮的受审版本与报告,不重新推导 `since`.

### Module Design Rationale

不存储逐文档基线: 替代方案是在 issue,审核记录或提交 trailer 中保存"上次全量审核点". 被拒绝,因为提交前无法强制写入,交错 effort 会互相消耗对方的基线,且从未审过的文档没有基线. 从 Git 历史推导起点的代价是并行 effort 时会多审而不是漏审,可接受. 起点推导放在 `lib/arw-common` 而不放在 Commit Audit 内: Spec Readiness 也需要同一规则,两份实现会漂移. 差异回归放在每次实施提交而不放在 Gate 2: 单个 effort 的整体差异可能很大,Reviewer 会略读;每次提交只审自己的差异,问题在引入的那次提交就被发现. 两个工作流都把 `since` 放进 Request 而不是 handoff 文本: Request 是 Reviewer 的唯一语义输入且被摘要覆盖,放进 handoff 会使同一 Request 在不同交接下得出不同范围. 代价是 Spec Readiness Request 结构增加一个字段. Spec Readiness 的 Input 改动用快照对 `git show` 的内容比较,而不是 `git diff <since> HEAD`,因为 HEAD 不含未提交的 Input 改动. Gate 2 增量审核的归纳前提是: 每处治理文档的改动在做出时都有人对照代码核对. effort 内的改动由 Gate 2 核对;effort 外的改动由规则与文档提交里的 `requirements-reviewer` 核对(该例外只覆盖改动审核系统本身或长期规范合同条款的提交). 剩余风险是: 不在该例外内的文档改动,以及从未审核过的旧文档,可能留有未被发现的缺口;设计接受这一风险,因为全量重审的成本随文档体积增长而收益只是反复发现旧缺口,需要时可另做一次分片审核. 删除 `## Spec Requirement` 的代价是 issue 本意要实现某个未改动章节的既有要求但 `What to build` 没写出,代码也没碰到时没有机械检查能发现;接受这个代价,因为它只会让缺口保持原状而不是造成回归,而选择错误的整类问题被消除. 改由 Reviewer 自行检索相关既有章节的代价是: 检索结果不绑定,不进入新鲜度,也不可复现;被拒绝的替代方案是 Main 在 Request 中给出提示锚点(会把选择工作和选择错误带回来),以及由 Engine 生成检索快照(需要新的工件格式与相关性判断). 这个代价被接受,没有机械补偿: Reviewer 漏检的相关章节,若 issue 未写出且实施代码也未触及,不会被任何后续检查发现(与上一条同一剩余风险);触及时由差异回归暴露. 检索只给出判断依据,不产生"已证明"的记录,Main 对每轮的抽查是唯一的人工校验.

### ADR Evaluation

本变化修改 ADR 0006 与 ADR 0023 的原决定,两条 ADR 就地改写并写明理由,不另建 ADR. ADR 0006 原来要求 issue 声明治理要求并以"显式输入比启发式发现更易审计"为理由;改写后治理 Input 仍由 Main 显式给出并被摘要绑定,只有"哪些既有章节与 issue 相关"这一判断改为 Reviewer 的检索,理由改为: 选择错误是就绪缺口的主要来源,而被检索章节只是比较证据,不授权也不记录. ADR 0023 原来规定 Gate 2 范围只来自 issue 声明引用的并集,"不从相关性或作为输出修改的长期 Spec 扩大". 改写后范围是 Git 推导的治理文档差异: "作为输出修改的长期 Spec"这一限定被明确撤销,effort 修改的长期规范和 ADR 现在正是 Gate 2 要审的内容(撤销理由: 这类改动此前从未对照代码核对);"不从相关性扩大"仍然成立,差异回归的检索范围(`docs/specs`,`docs/adr`,本 effort 的 spec)只是只读定位,不扩大 Gate 2 的审核文档. Gate 2 文档范围的权威来源由 issue 引用变为 Git 历史,这是被 ADR 0023 的改写明确记录的变化. 没有新增被 Git 跟踪的持久状态或安全边界: `since` 只作为字段出现在 Engine 管理的会话工作区 Request 中(该 Request 的生命周期与审核轮相同,提升后的就绪记录只保存 Request 摘要),每次 `prepare` 都从 Git 历史重新派生,没有任何跨轮存储的基线.

## Testing Decisions

- **Effort 起点推导**: 用真实临时 Git 仓库观察三种情形: effort 目录尚未提交时返回 `base`,已有提交时返回最早提交的父提交,effort 目录在根提交时返回空树. 防止的错误: 起点偏晚导致漏审,或根提交时命令失败.
- **起点推导失败**: 注入失败的 Git 运行器,观察 `deriveEffortStart` 抛出带 Git 错误输出的错误,`arw commit-audit prepare` 因此失败且不写出审核轮目录. 防止的错误: Git 失败被当作"effort 未提交"而静默审核错误范围.
- **Spec Readiness 起点推导失败**: 注入失败的 Git 运行器,观察 `arw spec-readiness prepare` 失败且不写出审核轮目录或 Request. 防止的错误同上.
- **Commit Audit**: 通过 `arw commit-audit prepare` 观察 Request 的 `gate2`: 治理文档有改动时 `documents` 含该路径并带 `since`,无改动时 `documents` 为空,effort 未全部终态时为 `null`;`input.json` 含 `gate2Exception` 时被拒绝. 防止的错误: 改了 spec 却不被审核,或无改动时仍要求例外.
- **Issue 解析**: 观察 `readIssueSubject` 对新格式(无 `## Spec Requirement`)与旧格式(含该章节)都返回正确 subject,章节缺失,重复或顺序错误时抛错. 防止的错误: 旧 issue 无法读取,新 issue 被拒绝.
- **Spec Readiness**: 通过命令行观察无 `## Spec Requirement` 的 issue 可以 `prepare`,`generate`,`promote`,`verify`;例外记录无需 issue 写 `Not required`;`prepare` 的 Request 含 `since`,Request 缺少 `since` 或含未知键时被拒绝. 
- **Artifact 迁移**: 观察含新格式 issue 的迁移不再被"必须先手写该章节"的诊断阻断.
- **Reviewer 能力场景**: 夹具删除 3 个选择类用例后场景仍可加载.

## Out of Scope

- 就绪新鲜度改为按改动绑定(记录格式升级,风险独立,另立待办).
- 迁移或删除现有 issue 中的 `## Spec Requirement`.
- 为从未全量审核的旧文档补审.
- 重新登记 Reviewer 能力基线.
