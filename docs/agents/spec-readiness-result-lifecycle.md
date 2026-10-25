<!-- arw:managed:start -->
# Spec Readiness 结果生命周期

## Generate

只在 Reviewer 返回 `ready` 后, Main Agent 才调用:

```text
arw spec-readiness generate --issue issue:<NNNN>:<NN> --input <draft-jsonl-path>
```

Main Agent 把精确绑定的 `draftPath` 作为 `<draft-jsonl-path>` 传入. ARW Engine 拒绝其他输入路径, 拒绝零字节或仅含空白的草稿, 并验证每个非空行. 无问题草稿必须符合 [Canonical Role](roles/spec-readiness-reviewer.md#output) 的独立标记格式; 标记重复, 包含额外字段或与问题记录混用时拒绝生成. 有问题时按检查分组, 规范化其顺序, 并以 `gap` 高于 `uncertain` 的优先级导出每个检查的结果.

存在 Requirements 问题时, 正式记录恰好包含前两个检查. 否则, ARW Engine 生成完整的适用检查集合, 并把没有问题的每个检查标记为 `satisfied`. 结果为 `satisfied` 的正式检查只包含其检查身份和结果.

ARW Engine 使用相同优先级导出整体结果, 在当前 Main Agent issue 工作区中写入包含 subject 和 Reviewer Role 身份的规范模式版本 6 记录, 并且只打印该记录的路径. `generate` 不把 subject 内容复制到记录中, 不把 Reviewer 原始状态作为语义输入读取, 不写入 `.scratch`, 不更新已完成基线, 也不授权实施.

## Promote

Main Agent 传入精确的生成路径, 不编辑其字节:

```text
arw spec-readiness promote --input <generated-path>
```

`promote` 是写入 `.scratch/<NNNN>-<effort-slug>/issues/<NN>.spec-readiness.json` 并更新已完成基线的唯一边界. 写入前, 它重新验证:

- 生成路径和当前记录结构.
- issue 身份, 活动请求的身份和摘要值.
- 当前 subject 内容身份.
- 当前 Input 字节和哈希.
- 当前 Reviewer Role 身份和哈希.
- 规范检查和派生结果.

任何失败都会使该 issue 先前的记录保持不变. 有效的 `gap` 或 `uncertain` 记录可以作为已完成的诊断结果进行提升, 但不能满足 [最终就绪授权时点](spec-readiness.md#authorization-timing).

## Respond to findings

Main Agent 在更改 issue 前独立验证每个 Requirements 问题. 问题有效时修正 `## Spec Requirement`, 对当前 subject 使用新的完整 `prepare -> review -> generate -> promote -> verify`. 符合质疑条件时保持 subject 不变, 使用[质疑工作流](spec-readiness-review-request.md#preparation-and-review). 两种情况都产生本轮新请求, 新绑定草稿及当前正式结果; 自身前轮原始材料仅按[公共复审规则](reviewer.md#review-changes-and-prior-coverage)确认覆盖, 不作为本轮输出或转授新版本的正式授权.

## Formal checks

前两个正式检查总是 `SPEC-READINESS-INPUTS` 和 `SPEC-READINESS-REQUIREMENTS`. 如果 Requirements 存在 `gap` 或 `uncertain` 问题, 该精确前缀就是完整的正式检查集合. 否则继续执行 `SPEC-READINESS-RATIONALE`, `SPEC-READINESS-ADR-EVALUATION` 和 `MODULE-DESIGN-APPLICABILITY`. 对任何 `Not required:` 格式添加 `MODULE-DESIGN-EXEMPTION`. 对任何完整格式添加 `MODULE-DESIGN-MODULES`, `MODULE-DESIGN-INTERFACES`, `MODULE-DESIGN-SEAMS-ADAPTERS`, `MODULE-DESIGN-DEPENDENCIES-DATA-FLOW` 和 `MODULE-DESIGN-RATIONALE`.

## Evidence and verification

并行期间源 subject, Input 或 Reviewer Role 改变时, 旧草稿只代表启动版本. `generate`, `promote` 与 `verify` 继续核对当前内容, 不忽略哈希或身份变化. 新版本准备完整当前工作流, 语义复审按[公共规则](reviewer.md#review-changes-and-prior-coverage)确认历史覆盖和变化影响, 不默认全盘重审. 成功结果和授权时点遵循[就绪规则](spec-readiness.md#authorization-timing); [issue 记录章节](issue-tracker.md#issue-record-sections)不成为设计要求或独立授权.

Reviewer 草稿的证据使用 [问题记录](roles/spec-readiness-reviewer/findings.md#evidence) 定义的路径与正文行号字符串. Engine 根据不可变请求解析完整定位, 按 [正文证据合同](../specs/agent-repository-workflow/spec.md#generate-promote-and-verify) 归一化为去重排序的 `{filePath, line}` 数组, 保留模式版本 6 的正式单行表示. 无效定位不产生部分正式结果. 只有 `SPEC-READINESS-INPUTS` 和 `SPEC-READINESS-REQUIREMENTS` 还可以引用 subject 路径来标识所选范围. 其他检查不得使用 subject 证据. 提升后运行 issue 特定验证. 验证只读取该 issue 的伴随文件, 并检查当前 subject 内容身份, 当前 Input 字节, 当前 Reviewer Role 字节, 定位信息目标和精确的 issue 身份. 普通记录和例外记录都使用模式版本 6, 并绑定相同的 subject 内容身份. 版本 5 和所有更早版本都已过期, 不能被提升, 验证, 迁移或用作授权. 现有的 effort 根目录 `spec-readiness.json` 只是历史记录. ARW Engine 不把它作为后备路径读取, 也不迁移或删除它. 生成和提升操作本身不构成授权.
<!-- arw:managed:end -->
<!-- arw:repository-owned:start -->
None.
<!-- arw:repository-owned:end -->
