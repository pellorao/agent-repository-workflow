# Spec Readiness 新鲜度只用于开始实施

## Problem Statement

Spec Readiness 记录绑定治理 Input, Reviewer Role 和 subject 的字节, 目前在实施开始前和每次实施提交前都用 `arw spec-readiness verify` 重新核对. 实施已经开始之后, 这个核对产生大量误报:

1. 一个 issue 自己的交付可能就是修改它的 Input (例如 ADR 或 Reviewer Role), 提交时 `verify` 因此报告过期, 迫使对已经写好的实现再做一轮就绪审核.
2. 其他 issue 或 effort 在这期间修改了与本 issue 无关或只是相关的文档, 同样使记录过期. 已经完成实施的 issue 在收尾提交中被再次验证时也会失败.

记录的本意是授权从经过独立审核的设计开始实施. 开始实施之后, 设计改动已有另一道检查: 每次实施提交的 Commit Audit 做 Gate 1 (对照 subject) 和差异回归, effort 终态时做 Gate 2 (逐块核对治理文档改动). 在两处同时要求同一份字节摘要, 只增加返工, 不增加保证.

## Solution

最终状态如下.

- 就绪记录的新鲜度只在开始实施时检查. 首次修改本 issue 的实现文件前运行完整 `arw spec-readiness verify --issue`, 要求 Input, Reviewer Role 和 subject 都与记录一致. 此时出现过期, 按 `spec-readiness` Skill 的复审规则做一次增量复审 (Reviewer 只看改动), 不由 Main Agent 自行判断改动是否相关.
- "实现文件" 指该 issue 交付的所有已跟踪文件 (代码, 测试, 文档, 规则, 包括它自己的治理 Input), 不含 `.scratch` 中该 issue 的 issue 文件与就绪记录. 所以修改 Input 本身之前也要先取得完整 `verify` 的 `0`.
- "已开始实施" 只由规则界定, 不由引擎判断: 当前分支已有本 issue 授权的实施提交, 或工作树中已有本 issue 的实现改动. 已开始实施后, Input 和 Reviewer Role 的字节变化不再阻断实施, 中断后恢复实施也不重跑完整 `verify`.
- 实施提交 (`commit` Skill 的实施工作流, 包括让 issue 进入终态的收尾提交) 对每个授权 issue 运行 `arw spec-readiness verify --subject-only --issue ...`, 只核对 subject (`## What to build` 到 `## Acceptance criteria`; 只勾选验收项按现有规则规范化, 不算变化). 这抓住实施中途悄悄修改要做的内容或验收标准的情形, 因为 Gate 1 只对照改后的 subject, 发现不了. `--subject-only` 在运行时读工作树字节, 与完整 `verify` 相同; 候选中的 subject 是否就是被核对的 subject, 由两处共同保证: `arw commit-audit verify` 机械核对暂存的 subject 在 `prepare` 之后没有改动, `commit` Skill 要求运行 `verify --subject-only` 前确认授权 issue 文件没有未暂存修改 (`git diff --quiet -- <issue 文件>`), 使工作树字节等于暂存字节. 两者合起来覆盖进入候选的 subject.
- 除上述实施提交外, 不为 issue 收尾或已完成的 issue 另行验证. `promote` 不变: 仍在写入记录前重新核对全部字节. 记录格式不变, 保留 Reviewer Role 绑定, 它在 `promote` 和开始实施时仍有用.
- 实施期间设计的改动由已有检查覆盖: 本 effort 的治理文档改动由 Gate 2 核对, 其他 issue 或 effort 的相关改动由本 issue 之后每次提交的差异回归, 加上对方 effort 自己的 Gate 2 核对.

## Implementation Decisions

- 长期规范 (主 spec 的 Spec Readiness 一节) 定义一次该开关的精确合同: 带开关时 `verify --issue` 只核对 subject, 不重新检查治理 Input 与 Reviewer Role; 记录缺失, 格式错误, 过期的模式版本, `not-applicable` 例外记录, 结果必须为 `satisfied` 与完整 `verify` 相同; 退出码只证明 subject 条件.
- `--subject-only` 是 `verify` 的可选开关, 只跳过 Input 和 Reviewer Role 两个检查块, 其余 (记录缺失或格式错误, `not-applicable` 例外记录, subject 比较, 结果必须为 `satisfied`) 与完整 `verify` 相同. 退出码语义不变.
- 新鲜度检查移到开始实施这一时点后, 原先 `architecture-evidence` 不检查字节的豁免被新规则包含: `architecture-evidence` 仍不进入开始实施时的字节检查 (它是 issue 自己会修改的实现事实), 该豁免句并入 `spec-readiness` Skill 的新时点规则.
- 为什么不让引擎判断 "已开始": 状态字段没有进行中的值, 查 Git 历史会增加代码, 而规则判断足以覆盖; 提交时的 `--subject-only` 不依赖这个判断.
- 为什么不在引擎里区分本 issue 自己的改动, 或把记录绑定到受审提交只在相关章节变化时过期: 都需要相关性判断, 引擎无法做, 交给 Reviewer 就等于复审; 改为开始实施后不检查, 同样覆盖这些情形.

## Module Design

### Modules

- **Spec Readiness**(`lib/spec-readiness/`): `verifySpecReadiness` 增加 `subjectOnly` 参数; 责任和依赖不变.
- **命令行**(`lib/arw.mjs`): `spec-readiness verify` 解析可选 `--subject-only`.

### Interfaces

- `arw spec-readiness verify --issue issue:<NNNN>:<NN> [--subject-only]`: 带开关时跳过 Input 与 Reviewer Role 的字节核对, 其余行为与退出码 (`0` 满足, `1` 不满足, `2` 用法无效) 不变.
- `verifySpecReadiness({issueId, repositoryRoot, subjectOnly})`: `subjectOnly` 是布尔值, 缺省为 `false`; 参数来自命令行解析, 不再校验.

### Seams and Adapters

不新增 Seam.

### Dependencies and Data Flow

依赖方向和数据流不变. 记录文件格式不变 (模式版本 7).

### Module Design Rationale

选择命令行开关而不是在 Skill 中规定 "提交时忽略 Input 过期的发现": 后者使退出码不再是硬门槛, Agent 容易误判. 开关只放宽误报多的部分, subject 的严格程度保持不变. 代价是公开命令多一个选项.

### ADR Evaluation

本变化缩小就绪记录的授权范围 (这是授权边界的变化, 经下述 ADR 处理): 记录从 "完成与实施提交前都须有效" 改为 "授权开始实施, 提交时只核对 subject". 它修改 ADR 0006 (就绪记录的授权时点, 含 "两层中的任何问题都关闭式阻止 issue 完成, Commit Audit 与提交授权" 一句, 其中新鲜度问题在开始实施后不再阻止完成或提交) 与 ADR 0023 (含 "就绪输入变化时刷新最终版本的正式结果, 不以旧结论满足新的完成或提交授权" 一句, 以及并行审核前须 "当前有效" 就绪的表述) 的原决定. 不另建 ADR 而就地改写: 两条 ADR 的核心决定 (实施前独立审核, 字节绑定, 提交时独立审核) 不变, 只有授权时点和范围变化, 一条新 ADR 会与它们并存并留下两处相互引用的矛盾文字. 冲突按 domain-modeling 的要求显式保留: 改写后的两条 ADR 在各自已有的章节 (ADR 0006 的 `Decision rationale` 简述并引用 ADR 0023, ADR 0023 的 `Decision` 末尾与 `Consequences` 为完整说明) 中写明被修改的原决定, 修改理由 (开始实施后同一份字节摘要在就绪与提交审核两处重复要求, 只增加返工) 与新的接受成本, 读者不必查 Git 历史. 没有新增持久状态或安全边界; 主 spec 和 Skill 中引用这些时点的措辞随之同步.

### Accepted cost

开始实施后到 effort 终态之间 (Reviewer Role 文件在此期间的变化不被任何提交审核核对, 只影响之后的就绪审核), 治理 Input 的变化对就绪记录不可见, 只由本 issue 之后每次提交的差异回归和 effort 终态的 Gate 2 核对. 设计改动在实施中途发生而代码尚未体现它时, 最早可能到 Gate 2 才被发现; 开始实施前的完整 `verify` 与提交时的 subject 核对继续限制 "未经审核就开始" 与 "悄悄改要做的内容" 两类风险. 这个窗口的代价被接受, 因为被替换的字节摘要检查对实施中途的设计改动只能报告过期而不能判断它是否正确, 每次触发都需要同样由 Reviewer 完成的复审.

## Testing Decisions

- **`--subject-only`**: 构造一个记录有效但治理 Input 之后被修改的 issue, 观察完整 `verify` 退出 `1` 并报告 `Stale Spec Readiness Input`, 带 `--subject-only` 退出 `0`; 再修改 subject, 观察 `--subject-only` 退出 `1` 并报告 subject 过期. 防止的错误: 开关同时放宽了 subject 检查, 或没有放宽 Input 检查.
- **开关不改变其余检查**: 带 `--subject-only` 时, 记录缺失退出 `1`, 结果为 `gap` 退出 `1`, `not-applicable` 例外记录且 subject 一致时退出 `0`, 用法无效 (`--subject-only` 缺 `--issue`) 退出 `2`. 防止的错误: 开关误跳过记录或结果检查.
- **命令行入口**: `tests/arw-entry.test.mjs` 的用法文本包含新选项.
- 文档和 Skill 的改动按 `arw text check`, `arw terms check` 和分发检查验证.

## Out of Scope

- 在引擎中判断 "已开始实施", 或为此在状态字段加进行中的值.
- 记录格式升级, 或把记录绑定到受审提交与相关章节.
- 删除记录中的 Reviewer Role 绑定.
