# 使用配置驱动的平台 Skill 引用转换

## Context

上游 Skill Package 可能同时包含多个平台的原生文件与引用形式, 不能仅凭一个来源平台标签推断整个软件包的语义. 目标平台需要准确的 Skill 引用写法与原生配套文件, 而源码仓库只应维护一份实际使用的共享内容.

## Decision

当前统一 Skill 来源使用 Codex 引用形式. [开发长期规格](../specs/agent-repository-workflow-development/spec.md#projection-configuration) 负责平台投影配置与 [Skill 引用分析和转换](../specs/agent-repository-workflow-development/spec.md#analysis-and-conversion): 配置说明支持平台的引用写法和目标位置, 投影只转换经过解析和必要审核的 Markdown Skill 引用. Upstream Sync 中由 Agent 把采用的上游引用改写为统一来源形式 (见 [ADR 0011](0011-use-source-only-human-reviewed-upstream-sync.md) 的状态说明).

实际 Skill 中的 `agents/openai.yaml` 是 Codex 调用数据的唯一内容权威. Codex 投影保留它, Claude Code 投影排除它; 投影不依据 frontmatter 过滤 Skill, 也不从表面语法推断调用政策. 固定输入的转换应产生可复现的目标字节, 无法确定的引用由用户审核, 不能用整个 Markdown 范围的搜索替换代替结构化分析.

`$reviewer-benchmark` 的实际 Skill 在自己的 `agents/openai.yaml` 中把 `policy.allow_implicit_invocation` 明确设置为 `false`. 用户准确输入该名称才触发基准操作, 其他 Skill 不自动转调. 原生调用元数据与操作规则由同一个实际 Skill 拥有, 使平台能够消费显式调用限制, 避免按任务相似性自动开始模型测量.

原先每个软件包单独绑定有版本的 Skill Package Grammar 的机制已由 [ADR 0026](0026-use-source-checkout-workflow-files-as-distribution-authority.md#decision) 取代. 当前投影配置, 转换代码和待安装载荷由同一 Git 修订版本绑定, 不读取旧语法文件或维护其升级路径.

## Rejected alternatives

不把整个 Workflow Distribution 标记为单一上游平台方言, 因为软件包可以同时携带多个平台的文件. 不为每个片段提供任意改写规则, 因为它会形成难以审核的软件包专用转换语言. 不把未知引用直接当成真实 Skill, 也不静默删除原文; 当前引用审核负责确定范围外的真实引用和需要规范化的位置.

## Consequences

共享 Skill 内容可以保留上游材料并通过配置生成不同平台的准确投影. 新的引用形式或平台映射需要在现行配置, 转换合同及其验证中明确处理, 不再增加独立的 Grammar 版本.
