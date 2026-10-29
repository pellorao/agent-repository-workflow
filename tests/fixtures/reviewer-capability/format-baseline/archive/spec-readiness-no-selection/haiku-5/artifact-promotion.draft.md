- SPEC-READINESS-INPUTS, gap: `artifactId` 的身份来源没有任何 Input 定义. promote 成功结果和 Result Summary 都要求 `artifactId` 等于 "validated artifact identity" (`specs/promotion-runtime.md:37`, `specs/result-summary.md:11`, `architecture/05-validation-report.md:33`), 但 canonical readiness artifact 只包含 `{requestId, checks}` (`architecture/05-validation-report.md:9`). 因此 `artifactId` 和 `summary` 的输入无法确定, 交付的成功结果既不能实现也不能验证.

- SPEC-READINESS-INPUTS, gap: `immutable request` 的 `requestId` 以及 "当前 request 已绑定的 artifact path" 没有任何 Input 定义. promotion 的 binding 前置条件依赖这两者 (`specs/promotion-runtime.md:11`), 而 `promote(inputPath)` 的 Interface 不携带 request (`specs/promotion-runtime.md:37`), architecture 只在 artifact 内定义 `requestId` (`architecture/05-validation-report.md:9`). 因此 binding 的数据来源和比较对象无法确定.

- SPEC-READINESS-INPUTS, uncertain: 目标 `docs/reference/validation-report.md` 是否为 generated artifact 没有任何 Input 说明. `specs/export-retention.md:5` 规定只有 generated artifact 目标才构成 export 并适用 ADR 0005 的 30 天 retention, 而 `specs/reader-index.md:9` 把 reader link 指向该目标, `architecture/05-validation-report.md:49` 只说明它已存在且为 stable target. 在该事实缺失时, 本交付是否适用 retention 义务无法判断.

- SPEC-READINESS-REQUIREMENTS, uncertain: `specs/runtime-migration.md:5` 声明更新 reader guide, `specs/runtime-migration.md:11` 声明 "同一次交付发布 promotion runtime migration", `specs/runtime-migration.md:19` 指定外部 rollout 协调, 但 subject 只列出 Reader Index Update 和 promotion/recovery 行为 (`.scratch/0001-reviewer-capability/issues/01-review-readiness.md:3`), 没有指明 reader guide 文件和修改内容. 完整请求无法确定这些 guide 和 rollout 义务是否属于本 issue 交付, 因而其验收范围和可实现性不能判断.

- SPEC-READINESS-REQUIREMENTS, gap: parser 的单次扫描要求与 architecture 的校验顺序冲突. `specs/parser-scan.md:9` 要求 size check 后只用一个 forward cursor 完成 token 识别和字段收集, 且不 rescan; 但 `architecture/05-validation-report.md:29` 规定 UTF-8 编码检查先于 JSON 语法检查, `architecture/05-validation-report.md:45` 要求 invalid UTF-8 返回对应 diagnostic. 当输入较前位置有 JSON 语法错误, 较后位置有 invalid UTF-8 时, 单次前向扫描会先报告 invalid-json, 与合同冲突. spec 未说明如何在一次扫描中保持 UTF-8 优先, 也未说明是否允许单独的 UTF-8 预检查.

- SPEC-READINESS-RATIONALE, gap: access-review 的 Design Rationale 只写了 "每次读取都重新执行 policy evaluation" 及其延迟成本 (`specs/access-review.md:19`), 没有替代方案 (如复用已求值的决定) 和拒绝理由. 这是影响授权结果时效性的重要取舍, 缺少这些理由无法评估其合理性.

- SPEC-READINESS-ADR-EVALUATION, gap: promotion-recovery 的 ADR 结论与 ADR 0001 冲突. `specs/promotion-recovery.md:95` 把新的 rollback recovery result 视为 ADR 0001 已有 rollback responsibility 的表现形式, 但 `docs/adr/0001-persistence.md:5` 明确 "本既有决定不定义本次新增的 recovery-result 字段和失败生命周期". `specs/promotion-runtime.md:85` 又把 Recovery 新结果的评估委托给该设计. 因此新增的公开 recovery result 和失败生命周期没有经过 ADR 0001 要求的 commit order 与 recovery ownership 评估, "不需要新 ADR" 的结论缺少依据.

- SPEC-READINESS-ADR-EVALUATION, gap: promote 的安全和授权边界没有一致地清点. `specs/runtime-migration.md:37` 称 protected operation "复用现有 authorization policy", 因而不形成新的 security decision; `specs/promotion-runtime.md:5` 只说明调用方已完成 access control. 但 `specs/access-review.md:5` 和 `specs/access-review.md:37` 新增了 Input author 提供 policy 的 reviewAccess 边界, 且该边界只约束 artifact read, 没有任何 spec 说明 promote 是否或如何经过它. 三处对 promote 授权来源和是否新增 security decision 的结论互相不一致.

- MODULE-DESIGN-APPLICABILITY, gap: `specs/result-summary.md:19` 使用 `Not required:`, 但该变更为 `promote` 的 successful result 新增 `summary` 字段 (`specs/result-summary.md:5`, `specs/result-summary.md:11`), 这改变了公开 Interface 的形状. 按 MODULE-DESIGN-APPLICABILITY 规则, 此类文档应使用完整 Module Design 格式, 不能省略.

- MODULE-DESIGN-EXEMPTION, gap: `specs/parser-scan.md:17` 的 `Not required:` 只写了 "The parser optimization preserves the current architecture.", 没有说明为什么 Module 责任, Interface, Seam, 依赖, 权威来源和数据流都不变. 这是笼统结论, 不构成有效的例外说明.

- MODULE-DESIGN-MODULES, gap: promotion 对 request 和 artifact 的验证被分配给两个 Module. `specs/promotion-runtime.md:27` 写 Readiness 验证 request 和 artifact, 又写 Promotion 在 persistence preconditions 之前 "再次验证 request 和 artifact"; 而 `specs/promotion-runtime.md:11` 要求 Promotion "信任此前置条件". 验证责任有两个所有者且结论矛盾, 再次验证失败时的结果也未定义.

- MODULE-DESIGN-MODULES, gap: canonical artifact 的 Invalid Artifact Contract 校验被两个 Module 各自实现. `specs/validation-report.md:31` 让 renderReport 与 parseArtifact 分别执行同一校验, `specs/validation-report.md:90` 接受这一重复成本, 而 `specs/parser-scan.md:9` 已把 parsing responsibility 独占给 Parser. 同一合同有两个实现所有者, 违反单一责任要求, 且两条 public lifecycle 可能出现分歧.

- MODULE-DESIGN-MODULES, gap: promotion-recovery 的 recovery input 校验由 Promotion 和 Recovery 重复执行. `specs/promotion-recovery.md:31` 要求 Promotion 在交给 Recovery 前按 Invalid Input Diagnostic 检查, `specs/promotion-recovery.md:41` 与 `specs/promotion-recovery.md:65` 又要求 Recovery 按同一顺序验证同一对象, 形成重复的策略编排.

- MODULE-DESIGN-INTERFACES, gap: renderReport 的 source 类型和 invalid-artifact 的 `path` 取值未定义. `specs/validation-report.md:11` 只定义缺失 source 的 invalid-input, 非字符串或空 source 没有合同; `specs/validation-report.md:45` 返回 `path`, 而 `architecture/05-validation-report.md:29` 定义的 path 是 "caller 提供的 artifact source path", 未说明它与 renderReport 的 `source` 的对应关系. 调用方无法知道公开失败中的 `path` 取值, 相关测试也无法确定期望结果.

- MODULE-DESIGN-INTERFACES, gap: `unexpected-field` 在首错顺序中的位置未定义. `specs/validation-report.md:45` 要求 extra field 返回 `unexpected-field` 并 "使用该合同的 validation order", 但 `architecture/05-validation-report.md:29` 的顺序只列出 root object, requestId, checks 以及 entry 的 object, check, result, finding, uniqueness 和 order 检查, 未列出 extra field 检查. `specs/validation-report.md:104` 又要求多个错误同时存在时只返回合同顺序中的第一个错误, 因而 extra field 与其他错误同时出现时的结果无法确定.

- MODULE-DESIGN-INTERFACES, gap: reviewAccess 的 Interface 没有 verified principal 的输入. `specs/access-review.md:37` 只接收 request, 但 `specs/access-review.md:11` 要求只信任 caller boundary 传入的 verified principal, `specs/access-review.md:15` 与 `specs/access-review.md:55` 说 decision 只对 verified principal 作出, `specs/access-review.md:93` 要求测试 principal 来自 caller boundary. `rules/01-required-inputs.md:5` 要求 review boundary 接收 verified principal. 没有 Interface 说明 principal 如何进入 Module, 因而身份来源既不能实现也不能测试.

- MODULE-DESIGN-INTERFACES, gap: reviewAccess 的测试边界 "Policy Adapter failure" 没有公开结果定义. `specs/access-review.md:93` 把它列为 public lifecycle 测试, 但 `specs/access-review.md:45` 的 Other Results 和 `specs/access-review.md:51` 的 Seam 合同只定义 allowed, denied, invalid-policy, invalid-request 和 artifact-read-failed, 未给出 adapter 失败的 `failureCode`, 形状或是否读取 artifact.

- MODULE-DESIGN-INTERFACES, gap: promotion 的 request binding 不匹配时的结果未定义. `specs/promotion-runtime.md:11` 写明 Readiness 在调用 persist 前检查 requestId 和 inputPath 的绑定, 且 "不增加 ... 失败分支", 但没有说明不匹配时 promote 返回什么. `specs/promotion-runtime.md:97` 又把该前置条件交给源码审查核对, 而源码审查没有可比较的预期结果.

- MODULE-DESIGN-INTERFACES, gap: `persistence-precondition-failed` 的触发条件未定义. `specs/promotion-runtime.md:41` 定义了该 failureCode 和 operation, `specs/promotion-runtime.md:45` 要求 persist 先检查 preconditions, `architecture/02-commit.md:5` 也只说 Promotion 先检查 preconditions. 没有任何 Input 指明哪些条件构成 precondition, 因而该公开失败既不能实现也不能测试.

- MODULE-DESIGN-INTERFACES, gap: rollback failure 的 `failureCode` 取值未定义. `specs/promotion-recovery.md:47` 与 `specs/promotion-runtime.md:41` 只规定形状 `{recovered: false, failureCode, ...}`; `specs/promotion-recovery.md:59` 说 Recovery "同时保留原始 commit failure 与 restore failure" 并形成该公开 shape, 却没有说明 `failureCode` 取原始 commit failure code 还是 `restore-failed`. successful rollback 中 `failureCode` 等于 commitFailureCode (`specs/promotion-recovery.md:19`, `specs/promotion-recovery.md:51`), 调用方无法从 rollback failure 确定该字段.

- MODULE-DESIGN-INTERFACES, gap: `recoverPromotion(input)` 的输入权威不一致. `specs/promotion-recovery.md:19` 把 `failedCommitId` 和 `commitFailureCode` 列为 `recoverPromotion(input)` 的输入, `specs/promotion-recovery.md:103` 以 public lifecycle 测试它; 但 `specs/promotion-recovery.md:65` 与 `specs/promotion-recovery.md:85` 要求这两个值来自 Promotion 的失败尝试记录, 并拒绝 caller 自报. 同一输入既是公开输入又被禁止由 caller 提供, 实现者无法确定该 Interface 是否对外开放.

- MODULE-DESIGN-SEAMS-ADAPTERS, gap: operation membership 的授权决定有两个所有者. `specs/access-review.md:27` 规定 Access Review 独占 authorization decision, 并在 Seam 返回 allowed 后检查 `allowedOperations`; 但 `specs/access-review.md:51` 又让 Policy Evaluation Seam 及其 Live Adapter 对同一 policy 与 facts 返回 operation-not-allowed 的 denied 合同. 同一规则在 Seam 与 Module 中都可能决定结果, spec 未说明二者冲突时以谁为准, 这属于拒绝的重复运行时领域策略.

- MODULE-DESIGN-DEPENDENCIES-DATA-FLOW, gap: promotion-recovery 的 Dependencies and Data Flow 没有 Source/Authority 表. `specs/promotion-recovery.md:61` 至 `specs/promotion-recovery.md:77` 声明了 artifact, priorTrackedState, failedCommitId, commitFailureCode 和 baseline 的权威来源, 却没有 `rules/05-ordering.md:5` 要求的权威来源表, 这些权威无法集中核对.

- MODULE-DESIGN-DEPENDENCIES-DATA-FLOW, gap: promote 成功 commit 后 temporary baseline 的状态未定义. `specs/promotion-runtime.md:61` 与 `specs/promotion-runtime.md:77` 只说明失败路径上 baseline 作为 recovery evidence 保留, `specs/promotion-runtime.md:37` 只说明成功结果不含 baseline identity, `architecture/02-commit.md:5` 也没有成功路径的清理规则. 成功路径上 baseline 被保留, 删除还是由他方清理无法判断, 形成未定义的可变状态转换.

- MODULE-DESIGN-DEPENDENCIES-DATA-FLOW, gap: Promotion Flow 没有指明 artifact bytes 由谁、在何时读取. `specs/promotion-runtime.md:51` 让 Promotion 把 Artifact Storage 读取失败转换为 expected filesystem failure, 但 `specs/promotion-runtime.md:57` 的 Flow 从 Readiness 验证 immutable artifact 开始, 没有读取步骤. 读取失败的调用者及其在验证和持久化之前的位置无法从数据流确定.

- MODULE-DESIGN-DEPENDENCIES-DATA-FLOW, gap: retentionDays 在 persistence 中的效果未定义. `specs/promotion-runtime.md:15` 要求成功 tracked artifact 自 commit 起保留 30 天, `specs/promotion-runtime.md:57` 把 retentionDays 传给 persist, `specs/promotion-runtime.md:45` 只说 persistence "消费此值". 没有说明 retention 被记录在哪个持久状态中或产生何种可观察效果, 保留义务在数据流终点没有落地.

- MODULE-DESIGN-RATIONALE, gap: access-review 的 Boundary Alternative 只写了选择独立 Access Review Module (`specs/access-review.md:65`, `specs/access-review.md:67`), 没有替代边界和拒绝理由.

- MODULE-DESIGN-RATIONALE, gap: access-review 选择 Input author 的部署配置作为 policy 权威 (`specs/access-review.md:37`, `specs/access-review.md:61`), 但 Identity and Facts Authorities 理由 (`specs/access-review.md:75`) 只覆盖 identity 和 facts, 没有该 policy 权威的替代方案和拒绝理由.
