<!-- arw:managed:start -->
# Agent Repository Workflow 操作

在 Agent 编写的输出中使用完整的规范命令. 命令从当前目录发现最近的 Git 工作树根目录. 嵌套仓库绝不回退到外层仓库.

对于所有命令, 退出码 `0` 表示成功或已接受的空操作, 退出码 `1` 表示发现问题或操作失败, 退出码 `2` 表示命令用法无效.

`arw background-agent` 是供 Agent 工具连接的机器入口, 不属于面向用户的控制命令清单. 调用方通过它控制后台 Agent 工作, 入口连接结束不代表后台任务停止. 请求, 重连与通知遵循 [后台 Agent 控制规则](../specs/agent-repository-workflow/spec.md#background-agent-control); Reviewer 的角色, 报告与审核结果遵循 [Reviewer 责任](reviewer.md).

## Read-only operations

```text
arw workflow verify
arw workflow update --dry-run
arw code-map verify
arw text check
arw terms check
arw terms check --strict
arw terms check --include .scratch/<NNNN>-<effort-slug>/
arw language inspect <repository-relative-path>...
arw module check-correction <local-module-issue-id>
arw list issues
arw list issues --all-statuses
arw list issues --status <status>[,<status>...]
arw list issues --type <implementation|application-source|wayfinder>[,...]
arw list maps
arw list specs
arw list background-agents
arw print <canonical-id>
arw spec-readiness prepare --issue issue:<NNNN>:<NN> [--input <temp-json-path>]
arw spec-readiness verify --issue issue:<NNNN>:<NN>
arw commit-audit verify
```

`arw list issues` 默认返回当前最前沿的 issue.

`arw list background-agents` 只读查询当前用户跨仓库的后台环境, 表格和 Main 会话展示遵循 [后台 Agent 列表](../specs/agent-repository-workflow/spec.md#background-agent-listing). 查询不授予分派或控制权限.

`print` 将原始 ARW Artifact 内容写入标准输出, 将诊断信息写入标准错误. `open` 是供用户使用的便捷操作. 两者都接受一个本地 `issue:<NNNN>:<NN>`, `map:<NNNN>` 或 `spec:<NNNN>` Canonical ID. 它们拒绝限定的 issue ID, 且不读取其他仓库或 Git 历史.

使用带参数的 `arw list issues` 时, 尽量结合 `rg` 等过滤工具验证期望条目是否存在, 或统计输出的条目数量, 避免把完整列表返回到 Agent 上下文. 计数时排除表头和分隔行. 过滤时保留命令失败, 诊断信息和 `arw` 自身的退出码, 并区分过滤工具未匹配与原命令失败. 只有任务确实需要逐项查看全部记录时, 才返回完整列表.

`arw terms check` 使用最近的 Git 仓库根目录和即时模式下的工作树. `arw terms check --strict` 使用发布模式的保留要求检查同一个工作树. 两种模式都不写入仓库状态.

两种模式默认都排除仓库根目录下的 `.scratch/**`. 重复使用 `--include <repository-relative-directory>` 可以包含选定目录. `--include` 只覆盖这一项默认排除, 且仍受 Git 忽略规则, 仓库根目录下的 `.arwignore` 和其他通用排除规则约束.

`arw terms check` 还显示每份所选文档正文的 Chinese, English 和 Other 比例, 但不根据比例改变诊断或退出码. `arw language inspect <repository-relative-path>...` 只分析显式文件或目录中的 Markdown 语言组成, 不判断预期语言或是否合格. 它接受多个路径, 递归展开目录, 不受 Git 跟踪状态或 `.arwignore` 限制, 不跟随符号链接, 并始终排除 `.git`. 任一显式目标无效时, 整次调用失败且不显示部分结果.

## Mutating operations

```text
arw workflow init
arw workflow update
arw workflow remove
arw text fix
arw migrate artifacts
arw spec-readiness generate --issue issue:<NNNN>:<NN> --input <temp-json-path>
arw spec-readiness promote --input <generated-path>
arw commit-audit prepare --input <absolute-input-path>
arw commit-audit generate --request <absolute-request-path>
```

只有在相应的独立授权工作流中才执行生命周期写入. `arw workflow update` 会更改 Workflow Distribution. `arw migrate artifacts` 只迁移旧版 ARW Artifact 格式. 领取和解决仍然是 ARW Artifact 工作流规则, 不是独立的命令行命令.

## Complete invocation forms

```text
arw workflow init [--non-interactive (--reuse-profile | --platform <platform>... --domain-layout <layout> --code-map-root [<root>]... --code-map-include [<glob>]... --code-map-exclude [<glob>]...) --transform-existing-agent-docs <true|false> --orphan-code-map-readmes <delete|demote>]
arw workflow update [--non-interactive] [--dry-run] [--transform-existing-agent-docs <true|false>]
arw workflow verify
arw workflow remove [--non-interactive --arwignore <retain|delete> --code-maps <retain|delete> --mixed-agent-documents <retain|delete>]
arw code-map verify
arw text check
arw text fix
arw terms check [--strict] [--include <repository-relative-directory>]... [--verbose] [--language-threshold <name>=<percentage>]...
arw language inspect <repository-relative-path>...
arw module check-correction <local-module-issue-id>
arw list issues [--all-statuses | --status <status>[,<status>...]] [--type <type>[,<type>...]]
arw list maps
arw list specs
arw list background-agents
arw print <canonical-id>
arw open <canonical-id>
arw migrate artifacts
arw spec-readiness prepare --issue issue:<NNNN>:<NN> [--input <temp-json-path>]
arw spec-readiness generate --issue issue:<NNNN>:<NN> --input <temp-json-path>
arw spec-readiness promote --input <generated-path>
arw spec-readiness verify --issue issue:<NNNN>:<NN>
arw commit-audit prepare --input <absolute-input-path>
arw commit-audit generate --request <absolute-request-path>
arw commit-audit verify
arw --version
```

供用户使用的短别名是 `li`, `lm`, `ls` 和 `lba`. `open` 和 `print` 没有短别名. Agent 编写的指令使用上面的规范形式.

语言检查使用仓库 `arw.config.json` 的命名规则. `--verbose` 只改变显示范围. `--language-threshold <name>=<percentage>` 可重复覆盖不同检查项的本次阈值, 不写配置; 重复名称, 未知名称和无效比例是用法错误. 按 [验证规则](validation.md) 处理检查结果.

## Post-init handoff

`arw workflow init` 成功后, 使用完整的 Agent Post-init Handoff, 并审计其中列出的每个就绪范围. ARW Engine 观察到的缺口是该审计的输入, 不能证明不存在其他缺口.

如果根 `CONTEXT-MAP.md` 和根 `CONTEXT.md` 都不存在, 将其视为领域文档缺口, 并在合并的完成 issue 中包含选定的 Repository Profile 布局:

- `single-context` 仓库需要结构有效的根 `CONTEXT.md`.
- `multi-context` 仓库需要非空的根 `CONTEXT-MAP.md`, 以及它所标识的每个 `CONTEXT.md`.

结构有效的 `CONTEXT.md` 可以没有 `## Language` 条目. 不得让 `workflow init` 创建这些文档.

在该审计期间, 只要 Repository-owned 规则与当前安装的 Workflow Distribution 冲突, 都以 Workflow Distribution 为权威来源. 检查责任与 Workflow Distribution 规则重叠的每条 Agent 指令. 删除或重写每条冲突的 Repository-owned 规则, 使最终行为遵循 Workflow Distribution, 并删除语义重复项. 保留每条不冲突的 Repository-owned 规则, 并将其应用于剩余审计和初始化 issue 工作. 如果现有权威无法判定两条规则是否冲突, 停止受影响的工作并询问用户.

如果完整审计没有缺口, 则不创建 issue. 如果仍有任何缺口, 则精确创建一个合并的仓库工作流完成 issue, 并在普通实施前完成它. 在该 issue 中包含所有领域文档, 验证, 写作, `.arwignore`, 记录迁移, 受管理区域, 语义去重和 Code Map 工作.

审计每个由 Agent 管理的文档或规划记录路径, 检查使用本地语言的文件名. 对每个需要决定的当前路径, 给出一个建议的英文文件名. 只要还缺少任何用户文件名选择, 就将合并 issue 设为 `Status: needs-info`. 用户可以接受建议, 换成另一个英文文件名, 保留该文件的当前名称, 或通过一次选择保留所有当前名称. 只有记录每个文件名选择并解决其他所有阻断项后, 才将 issue 改为 `Status: ready-for-agent`.

对于每个保留的当前文件名, 在 `docs/agents/writing.md` 的 Repository-owned 区域中添加明确的例外. 记录精确路径, 当前文件标题路径和替代内容规则. 该例外只适用于经过审查的现有文件. 文件被删除或重命名后删除该例外. 它不授权未来文档使用本地语言文件名.

<!-- arw:managed:end -->
<!-- arw:repository-owned:start -->
## Source Checkout Repository Workflow boundary

不得对 ARW Source Checkout 运行 `arw workflow init`, `arw workflow update`, `arw workflow verify` 或 `arw workflow remove`. 它是其 Workflow Distribution 的创作源, 不是使用该 Workflow Distribution 的目标仓库. Source Checkout 验证使用 Workflow Distribution 的生产检查, Repository Workflow 验证则使用隔离的目标仓库.

## Source Checkout installation commands

- `node install.mjs` - 当安装程序存在且相关 issue 授权该工作时, 从克隆的 Source Checkout 安装 ARW.
- `node uninstall.mjs` - 从安装目录运行时删除已安装副本.

## Source Checkout release validation exception

`docs/agents/validation.md` 中的 Source Checkout 发布验证流程负责规定操作是否使用完整的 Agent Post-init Handoff. 对其他所有操作, 本文档的普通初始化后交接保持不变.
<!-- arw:repository-owned:end -->
