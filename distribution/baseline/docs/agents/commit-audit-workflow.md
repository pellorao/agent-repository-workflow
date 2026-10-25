<!-- arw:managed:start -->
# Commit Audit 工作流

准备或执行前, 满足[提交工作流的固定审计范围](commits.md#exclusive-commit-audit). 该规则拥有开始条件, 同候选并行, 索引与 HEAD 固定, 工作树写入及结束后暂存边界.

## Commit Audit Reviewer thread reuse

Commit Audit Reviewer 线程身份由两部分组成:

- `spawn_agent` 请求中的 `input.role` 字段固定为 `commit-audit-reviewer`.
- `authorizingIssueIds` 中经过完整排序的 issue ID 集合.

Main Agent 按 [Reviewer 操作步骤](reviewer.md#machine-operations)提供完整任务, 入口读取两级配置并通过独立 Codex App Server 启动. 首次不继承作者对话, 同角色和 issue 集合的后续调用复用可靠原线程, 交付完整当前输入及[公共复审规则](reviewer.md#review-changes-and-prior-coverage)允许的自身前轮原始报告和绑定输入, 默认差异复审并返回完整当前结果. 只有身份集合改变, 原线程不可恢复或用户明确要求时才新建替代, 不因字节或结论变化自动新建.

## Authorization scope and Gate 1 applicability

每次提交只包含一个 effort. Main Agent 只把当前 effort 的改动放入 Git 索引. `authorizingIssueIds` 是已暂存实施的完整 issue 授权范围, 可以包含该 effort 的多个 issue. Commit Audit Request 中的 Gate 1 范围只是本次提交实际适用的终态转换子集, 不要求与授权列表一一对应.

未完成的实施 issue 可以授权中间代码提交. 它出现在 `authorizingIssueIds` 中, 但不出现在 `gate1` 中, 因为其尚未完成的验收标准不得过早成为提交阻断项.

终态转换必须获得授权, 且必须具有 Gate 1, 包括 issue 新进入 `completed` 或 `wontfix`. ARW Engine 根据已暂存候选内容推导机械可见的终态转换, 并拒绝以下情况:

- 遗漏授权.
- 缺少适用的 Gate 1 项.
- 存在未授权的 Gate 1 项.
- 存在重复或冲突记录.

独立 Reviewer 判断 Git 无法证明的代码到 issue 关系, 包括只包含代码的候选内容和重新打开后再次完成的历史.

Gate 1 覆盖 `## What to build` 中每条非空, 非标题, 非围栏代码块的正文行和每条验收标准. 有效要求和替代决定必须进入正式要求或验收章节, [Validation 与 Comments](issue-tracker.md#issue-record-sections)不成为要求来源. 每项要求具有准确正数来源行, 简短要求, 证据及 `satisfied`, `gap` 或 `uncertain`. `satisfied` 须有证据且没有问题, 其他结果须有可采取行动的说明.

## Gate 2 scope

Gate 2 是 effort 级 Spec Audit, 不是 issue 审计. 当当前 effort 中的每个实施 issue 都处于终态时适用. ARW Engine 根据已经接受的授权 issue 和完整的已暂存 effort 清单推导适用性.

`.scratch/<NNNN>-<effort-slug>/spec-audit.json` 中的 `documents` 和要求, 是本批次已经接受的授权 issue 中有效 `## Spec Requirement` 引用的并集. 不得仅因 effort 把相关背景文档或长期规范作为输出更改, 就把它们加入其中. 每项独立的规范性要求都使用精确的治理来源行, 简短要求, 定向证据和结果. 审核范围和来源行数量下限遵循 [Gate 2 规则](roles/commit-audit-reviewer/gate-2.md).

如果适用 Gate 2 effort 的治理要求并集为空, 停止并取得用户明确确认. 只有包含具体 `reason` 和 UTC 秒级 `confirmedAt` 的批次例外才能产生完整的 `not-applicable` 记录. 空数组本身不构成确认.

## Independent Reviewer boundary

Main Agent 负责实施, 暂存, Request, Engine 调用, 审核协调和正式提升. `commit-audit-reviewer` 独立判断 Gate 1 和 Gate 2, 初次只接收当前 Request 路径, 后续另接受公共规则明确绑定的自身前轮材料作为覆盖历史, 不扩大当前证据或候选范围. 它按[单 Agent 规则](reviewer.md#single-agent-execution)亲自写完整当前 `review.jsonl`, 只返回状态. Main Agent 不代写语义判断, Reviewer 不调用 Engine, 生成正式 audit 或修改索引.

Main Agent 在仓库 `.tmp/` 下为本次审核建立独立目录, 并写入固定名称 `input.json`. 该对象只包含同一 effort 的完整排序 `authorizingIssueIds`, 以及适用时的单个 `gate2Exception`. 然后调用:

```text
arw commit-audit prepare --input <absolute-input-path>
```

`input.json` 的父目录就是本次 Request 目录. `prepare` 在该目录创建固定名称 `request.json`, 并在独立的 `reports/` 子目录中创建空 `review.jsonl`, 然后只返回 Request 的绝对路径. `reports/` 是本次审核唯一获授权的报告目录, `input.json`, `request.json` 和后续 Engine 正式结果保持在该目录之外. 除本次 `input.json` 外, 任何受管理文件碰撞都会使准备失败且不覆盖现有内容. 不同 Request 使用独立目录, 可以保留多轮记录, 但当前仓库的执行遵循上述排他规则, 不依赖全局当前 Request.

Main Agent 把准确当前 Request 路径放入 `handoff`, 后续按公共复审规则交付自身前轮原始报告, 旧请求及准确绑定的旧候选和输入. `reportPath` 使用当前 `draftPath`, 按共同操作步骤提供完整角色指令及读写范围, 入口统一读取用户配置. 不传其他角色报告或沿记录链接扩权.

Reviewer 运行时 Main Agent 保持完整索引, HEAD 和本轮输入不变, 允许工作树获准修改. Reviewer 可逐项写入和修订草稿, Main Agent 可读取讨论但不把中间稿当完整结果. Reviewer 完整返回 `ready` 后, Main Agent 按[记录章节规则](issue-tracker.md#issue-record-sections)机械核对并统一暂存记录差异, 再调用:

```text
arw commit-audit generate --request <absolute-request-path>
```

Engine 依次检查 `request`, `candidate-preconditions`, `review-syntax`, `requirement-coverage`, `evidence` 和 `output-plan`, 并只报告最早失败阶段中能够安全确定的全部诊断. `review-output-invalid` 由 Main Agent 完整转交同一 Reviewer 修订绑定草稿; `request-invalid`, `candidate-invalid`, `output-write-failed` 和 `generation-failed` 由 Main Agent 处理. 每次重试仍消费完整 JSONL.

成功时 Engine 在 Request 主目录中平铺生成 `03.audit.json`, `04.audit.json` 或 `spec-audit.json` 等适用文件, 并返回按 `targetPath` 排序的完整 `files` 映射. 每项 `sourcePath` 和 `targetPath` 都相对于仓库根目录, 且来源和目标各自唯一. Main Agent 只把映射指定的准确来源字节提升到对应目标并暂存. 任何结果为 `gap` 或 `uncertain` 都会阻止整批提升.

现有 Issue Audit, Spec Audit 和 Spec Readiness 记录不能作为证据或结论. 生成或验证这些记录的代码, 测试和文档仍可接受审查.

ARW Engine 从 Git 索引准备完整审核范围, 严格验证绑定 JSONL, 推导适用目标, 规范化证据和派生结果, 并只在完整成功时返回可提升的输出映射. 写入失败不返回映射, 尽力恢复已经写入的临时文件; 恢复失败的残留没有提升资格, 由后续完整重试覆盖. 正式 Gate 1 与 Gate 2 JSON 不使用 `schemaVersion`.

## Audit lifetime

Gate 1 和 Gate 2 只存在于提交准备阶段. implementation issue 可以进入 `completed`, Application Source Issue 可以镜像 `completed | wontfix`, Wayfinder issue 可以进入 `resolved`, 而无需审计伴随文件. `Full Issue Audit` 不是当前工作流.

Gate 1 或 Gate 2 只授权经过完整审计和验证的当前候选. 完整旧轮结束后, 仅记录章节差异经机械核对不要求新语义审查或替代 Request, 当前要求与证据定位仍须合法. 真正实施, 要求, 输入或结论变化需要新 Request, 原 Reviewer 按公共规则差异复审并写完整当前报告. 原样加入映射指定的正式输出, 提升后到 `verify` 完成前保持最终索引稳定. Main Agent 核对准确候选内容和允许差异, Engine 的范围相同不单独证明任意代码变化与旧判断无关.

`arw commit-audit verify` 只读取当前暂存终态变化所需的 Gate 1 和 Gate 2 记录. 仓库中的其他 audit 文件仅作为历史记录保留, 不参与当前候选验证.

## Gate 3

`code-review` Skill Package 唯一拥有代码轴比较, 输入, 结论复用, 完成标记, 线程和报告责任. 已有完整有效结果直接保留, 需要新判断的轴可按提交工作流与同候选 Commit Audit 并行. 审计开始前的当前就绪, 实施验证和真实候选条件由提交工作流拥有, 最终提交仍要求全部适用完整结果有效. 真正变化按公共规则复审, 记录收尾按其所属机械规则处理, 不新增第二套 Gate 3 或审核授权来源.
<!-- arw:managed:end -->
<!-- arw:repository-owned:start -->
None.
<!-- arw:repository-owned:end -->
