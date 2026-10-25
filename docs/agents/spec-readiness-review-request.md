<!-- arw:managed:start -->
# Spec Readiness 审查请求

## Terms introduced in this document

- **Reviewer Request**: 根据当前治理输入, 审查 subject 和 Reviewer Role 身份生成的不可变完整审查请求.

## Preparation and review

通过标准输入或临时 JSON 文件准备完整的 Input 集合:

```text
arw spec-readiness prepare --issue issue:<NNNN>:<NN>
arw spec-readiness prepare --issue issue:<NNNN>:<NN> --input <temp-json-path>
```

两种输入形式使用相同的 JSON 对象模式和诊断信息. 调用 `prepare` 前, Main Agent 选择一个尚不存在的安全绝对 `.jsonl` `draftPath`. 该路径必须位于当前 issue 的 `spec-readiness` 用途工作区内, 并使用 [Reviewer 运行规则](../specs/agent-repository-workflow/spec.md#reviewer-runtime)要求的独立报告目录. 不把 Request, 治理 Input 或执行规则副本放入该目录.

输入对象包含该 `draftPath` 和一个非空的 `inputs` 数组. 每个 Input 项具有 `role` 和相对于仓库的 `filePath`. 输入至少包含一个 `governing-spec` 或 `governing-prd`, 以及每个适用的 `adr`, `domain-context` 或 `architecture-evidence`.

无论声明的 Input 角色是什么, Agent 指令, Reviewer Role 内容和 Repository-owned 平台 Agent 配置都不是治理 Input. Reviewer 通过其 Canonical Role 和 `docs/agents/reviewer.md` 单独读取适用的 Agent 指令. 不得把任何已排除的资料声明为 Input. 如果输入可能接近平台命令或消息长度限制, 使用文件.

每个 Input 在准备时必须已经存在, 并且是本轮适用的权威设计或必要证据. 不得用尚未创建的输出或计划中的内容代替完整治理依据. 审核版本的固定与源工作树修改遵循 [Reviewer 版本规则](reviewer.md#review-versions-and-concurrency).

治理设计的修正仍须取得适用的用户决定与具体文档差异批准. 每轮准备绑定当时完整的设计字节, 已有的必要实现事实可以作为 `architecture-evidence`; 后续改变它们时, 按 [最终授权时点](spec-readiness.md#authorization-timing)刷新就绪, 不把先前版本的通过结果用于新内容.

本轮 Request 内的 Input 快照保持不变. 源 Input 后续发生变化时, 新版本使用新的完整工作流; 不因此省略任何适用治理 Input 或必要证据.

`prepare` 验证 `draftPath`, 必要时创建其父目录, 创建零字节草稿且不替换现有路径, 把当前 issue 中连续的 `## What to build`, `## Spec Requirement` 和 `## Acceptance criteria` 章节冻结为一个 subject, 在当前 issue 的临时工作区中创建新的不可变完整 Reviewer Request 文件, 并且只打印请求的绝对路径. Reviewer Request 绑定新的请求身份, issue 身份, 精确的 `draftPath`, subject 路径, 经过 LF 归一化的精确文本内容, subject 身份 SHA-256, 每份完整 UTF-8 治理 Input 快照, 每个 Input 的 SHA-256, 治理 Inputs 之外的规范 Reviewer Role 身份和 SHA-256, 以及请求摘要值. Reviewer 可以看到精确的 subject 内容. 仅在计算 Subject 身份时, 对 `## Acceptance criteria` 内且 Markdown 围栏代码外的列表项开头的实际任务列表标记, 把 `[x]` 和 `[X]` 规范化为 `[ ]`. Reviewer Request 摘要值仍然绑定精确的 subject 内容. Subject 不是治理 Input, 调用方不能提供或替换它. 后续的 `prepare` 会创建不同的请求路径, 并使较早的请求不再符合生成或提升条件. 不得把请求 JSON 复制到 Agent 消息中.

Reviewer 线程身份由 `spawn_agent` 请求中固定的 `input.role` 字段值 `spec-readiness-reviewer` 和完整排序的 issue ID 集合组成, 该集合只包含当前 issue. Main Agent 按 [Reviewer 操作步骤](reviewer.md#machine-operations)提供完整任务, 运行入口读取两级配置并使用独立 Codex App Server. 首次不继承作者对话, 后续复用可靠原线程. 每轮提供完整当前请求和新的空草稿文件, 后续另按[公共复审规则](reviewer.md#review-changes-and-prior-coverage)交接自身前轮原始草稿和准确绑定请求. 创建替代, 恢复和活动指示遵循上述步骤, 不因字节, 哈希或结论变化自动新建线程.

对于初次审查, `handoff` 的审查输入只提供不可变 Reviewer Request 的准确路径. 与用户沟通的 Main Agent 按上述操作步骤另外提供准确的报告写入范围, 运行入口读取 Reviewer 用户配置; 这些设置和路径不成为治理 Input 或证据. `reportPath` 使用 Request 已绑定的 `draftPath`. Reviewer 首先遵循其 Canonical Role 和 `docs/agents/reviewer.md`, 包括仓库内每条适用的 Agent 指令. 它使用 subject 快照识别 issue 中选定的要求范围, 并使用治理 Input 快照判断相应设计. Agent 指令管辖审查, 但不是治理证据, 也不扩大 subject. Subject 不能授权自身或证明设计质量. Reviewer 不读取治理 Input 所指的当前路径, 必须亲自将最终的只含问题的 JSONL 写入绑定的 `draftPath`, 并且只返回 `{"status":"ready"}` 或 `{"status":"incomplete","reason":"..."}`. Reviewer 按公共通信规则发送允许的中途消息. 它不读取或导出与用户沟通的 Main Agent 会话身份, 不读取 ARW Engine 实现或调用审核请求准备, 正式结果生成, 提升与验证入口, 不生成报告之外的其他路径, 也不在最终消息返回路径. Reviewer 按 [单 Agent 执行规则](reviewer.md#single-agent-execution) 独自完成审核, 不创建子 Agent 或协作文件. 现有 Spec Readiness, Issue Audit 和 Spec Audit 记录不能用作证据或先前结论.

Reviewer 按 [逐项更新草稿和完成后交付报告的规则](reviewer.md#review-handoff) 将核实的问题写入本轮指定的草稿, 并在审核过程中修订当前结论. Main Agent 可以按需读取以核对和讨论, 保持当前 Request, subject 和 Input 快照不变, 且只在 Reviewer 返回最终 `ready` 后把草稿作为完整结果. 已授权修正可以在源工作树并行进行; 修正后的版本重新准备完整请求, 不改写运行中的请求. 未完成草稿不交给 `generate`.

如果已经完成的 Spec Readiness 结果符合 `docs/agents/subagent-findings.md` 的质疑条件, 用未变的 subject 和治理 Input 重新 `prepare`, 创建完整新请求及 `draftPath`. 通过 `followup_task` 向原 Reviewer 交付新请求, 每个受质疑的问题及具体证据和推理错误, 自身前轮材料按公共复审规则交接. 质疑消息只作注意提示, 不是当前请求的治理 Input, 证据或授权. Reviewer 复核受质疑项及关联影响, 返回完整当前替代结果. 有争议结果按[授权时点](spec-readiness.md#authorization-timing)阻断对应完成, 审计和提交, 直到替代结果完成 `generate -> promote -> verify`. subject 或 Input 已改变时, 准备普通完整新请求并按公共规则差异复审, 不直接转用旧结论.

有问题时, 草稿是只包含问题的 JSONL. 每个非空行都是一个 JSON 对象, 只包含 `check`, `result: gap | uncertain`, 非空的 `evidence` 和非空的 `finding`. `evidence` 是数组, 使一个问题可以保留每个必要定位信息, 而不重复问题文本. `finding` 解释具体缺陷, 缺失或冲突的合同, 以及对就绪的影响. 它无需建议修复. 不得用数组或对象包装各行, 也不得写入结果为 `satisfied` 的检查, 派生结果或 ARW Engine 元数据. 无问题时按 [角色输出规则](roles/spec-readiness-reviewer.md#output) 在绑定草稿中写入明确的无问题标记, 使接收方能够区分无问题结论与尚未写入的空草稿. Main Agent 按 [共同交接规则](reviewer.md#review-handoff) 检查绑定文件, 正式生成只读取 `ready` 后的最终字节.

Reviewer 先按公共复审规则取得 `SPEC-READINESS-INPUTS` 和 `SPEC-READINESS-REQUIREMENTS` 的完整当前判断. 如果存在 Requirements 问题, 记录全部独立问题后结束语义审查; 前轮未完成的后续检查不能成为已通过覆盖. Requirements 没有问题时仍须完成全部其余适用检查, 未受影响的自身有效覆盖可保留. JSONL 不为 `satisfied` 或未执行检查提供占位符.
<!-- arw:managed:end -->
<!-- arw:repository-owned:start -->
None.
<!-- arw:repository-owned:end -->
