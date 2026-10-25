# 使用机械检查与独立 Reviewer Role 执行 Spec Readiness

## Terms introduced in this document

- **Reviewer Request**: `prepare` 根据当前输入和 Reviewer Role 生成的不可变完整请求文件, 与用户沟通的 Main Agent 只向独立 Reviewer 传递它的路径.

## Decision

ARW 对每个实施 issue 使用机械检查和独立语义审核共同判断 Spec Readiness. Engine 检查结构, 路径, 字节绑定, 派生结果和新鲜度; `spec-readiness-reviewer` 判断要求选择, 治理设计, 理由, ADR 和 Module Design 是否充分. 两层中的任何问题都关闭式阻止 issue 完成, Commit Audit 与提交授权; 已授权且不依赖该结果的实施可与首次审核并行, 具体检查时点由[设计就绪工作流](../agents/spec-readiness.md#authorization-timing)拥有. 必要设计决定和真实前置依赖仍须先满足. Application Source Issue 与 Wayfinder issue 不进入这项检查.

Engine 从当前 issue 的连续交付结果, `## Spec Requirement` 和验收条件冻结准确审核对象, 并与显式治理输入, Reviewer Role 身份及与用户沟通的 Main Agent 选定的草稿路径一起绑定到不可变 Reviewer Request. 审核对象只证明本次要求选择, 不能自行证明设计质量. Agent 指令规范 Reviewer 行为, Reviewer Role 正文与平台配置另有职责; 它们均不作为治理输入或设计证据. 审核对象身份对行尾及验收任务列表的完成标记作限定规范化, 其他内容变化使就绪失效.

独立 Reviewer 通过共享运行入口在独立 Codex 根线程中独自审查, 不创建子 Agent. 第一次启动的线程不含作者对话. Reviewer 读取完整请求和适用指令, 并亲自把问题或明确的无问题结论写入本轮绑定的草稿. 平台的 `ready` 回复只表示交付完成, 空草稿不能表示无问题. 同一 issue 后续的真实治理修复复用符合单 Reviewer 合同的可靠原线程, 每轮仍依据新的完整请求交付完整替代结果; 能力验证场景的线程不能充当真实审核线程.

后续复审遵循[当前版本与结果有效性合同](../specs/agent-repository-workflow/spec.md#review-versions-and-result-validity), 默认核对相邻版本差异及其全部关联影响. Reviewer 自己已完成的前轮原始报告与准确绑定输入可以证明历史覆盖, 当前设计证据仍来自完整当前版本. 旧问题和未完成检查不能省略, 需要全盘审核时由 Reviewer 给出具体理由. 正常请求准备, 草稿生成, 原样提升和 verify 保持不变, 不因保留历史覆盖而复用已经过期的正式记录.

共享 Reviewer 运行 Module 负责原生会话启动, 工作指示, 通知, 恢复, 单 Reviewer 运行事实核对和该线程的计量, 不判断治理设计是否充分. Spec Readiness Module 仍只机械验证绑定草稿并生成, 提升和验证正式记录, 不代写 Reviewer 结论, 不把文件新鲜度检查说成写入者身份审计. 运行合同由[长期规格的 Reviewer 工作流](../specs/agent-repository-workflow/spec.md#reviewer-workflow)拥有, 模型与平台权益不能从安装成功或种子默认值推断.

公开生命周期是 `prepare -> review -> generate -> promote -> verify`. Engine 从最终草稿生成规范结果; 只有 `promote` 将准确结果写到当前 issue 旁边, 只有当前有效且满足要求的 `verify` 结果授权 Spec Readiness 这一前提. 旧 effort 根记录不是回退来源. Issue 分流状态和阻断项另行判断; Git 差异, 提交来源和终态审核不替代本项就绪. [长期规格](../specs/agent-repository-workflow/spec.md#spec-readiness) 负责准确命令, 记录, 证据和失败合同, [ADR 0023](0023-separate-commit-audit-review-from-implementation.md) 负责提交时的独立审核.

Module Design 的适用性依正式运行代码的行为变化判断: 不修改正式运行代码时省略该章节, 模块相关设计不变时使用 `Not required:`, 相关责任或边界变化时使用完整设计. 章节形态是唯一适用性来源, 省略章节仍须完成 Spec Readiness.

源码仓库的定向 Reviewer 优化只有在当前 issue 已取得一次普通就绪, 且用户批准当前修改批次与定向验证后, 才能在该轮修改和验证之间延后重复审核. 优化结束且关闭 issue 前, 对最终治理输入重新完成普通就绪. 真实治理审核发现的问题直接进入普通修复和复审, 不进入能力验证的用户审核停点.

源码仓库发布验证还保留两项由[发布长期规格](../specs/agent-repository-workflow-release/spec.md)准确限定的例外. 一次受验目标仓库的登记初始化 issue 可以省略 Spec Readiness, 例外身份由发布流程与 Release Validation Registry 判定, 不扩展 Engine. Source Checkout 发布准备 issue 先取得普通就绪; 默认候选修复循环允许在中间修改与完整本地验证之间延后重复审核, 然后对最终候选完成普通就绪及适用的后续审核. 审核对象和输入未变时可以复用通过结果, 审核要求改变候选时仍须重新完成适用审核与完整本地验证. 这些例外不授权普通实施, 远程发布或跳过最终候选所需的审核.

## Decision rationale

- 机械规则可重复检查, 而设计是否充分需要独立判断. 把两者分开使 Engine 不伪装为语义 Reviewer, 也使 Reviewer 不负责生成或授权持久结果.
- 让 Engine 生成不可变 Reviewer Request 并明确绑定审核对象, 输入与草稿路径, 可以避免与用户沟通的 Main Agent 每轮手工拼装或让 Reviewer 猜测路径. 显式输入比启发式发现更易审计, 且无需另一份持久输入清单.
- Reviewer 的文件内无问题结论与平台完成回复分开, 可以区分真实通过与尚未写入或写错路径的草稿. 结果只提升 Engine 从准确草稿生成的字节, 不把问题改写为通过.
- 首轮隔离作者上下文保护独立判断; 同一 issue 复用可靠线程及自身准确前轮材料保留问题定位和已完成覆盖. 完整当前请求与当前证据决定每轮结果, 差异及关联影响决定需要重新判断的范围, 所以摘要变化本身既不要求新线程, 也不要求全盘重复审核.
- 把原生会话控制与结果生成分开, 可以让普通审核和验证使用同一运行入口而保留独立语义判断. 运行入口代写报告会混合作者, Reviewer 和 Engine 的责任; 接受绑定文件交接与后续机械校验的成本, 保留原始结论和准确提升边界.
- 先核对要求范围再判断设计, 防止基于多余或归属不明的要求产生无效结论. Issue 状态与阻断项另行检查, 因为它们不证明治理设计新鲜.
- 源码仓库的定向优化和发布修复都有已完成的初始授权与最终复审边界. 在每个中间修改后重复完整 Reviewer 流程会打断定向验证或发布候选收敛; 把例外放在拥有该流程的规则中, 可保留普通 Engine 合同.
- 发布受验系统中的初始化 issue 只用于证明一次性工作流生命周期. 让发布流程限定它, 可避免在通用 Spec Readiness 中加入机器, 场景或步骤分支.
