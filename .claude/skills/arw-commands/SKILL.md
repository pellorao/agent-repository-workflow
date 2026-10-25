---
description: 编写或运行 `arw` 命令, 查询 issue, map, spec 或后台 Agent 列表, 处理仓库发现, 或在 `arw workflow init` 后执行 Post-init Handoff 审计时使用.
name: arw-commands
---

# ARW 命令

在 Agent 编写的输出中使用完整的规范命令. 命令从当前目录发现最近的 Git 工作树根目录, 嵌套仓库绝不回退到外层仓库. 所有命令的退出码 `0` 表示成功或已接受的空操作, `1` 表示发现问题或操作失败, `2` 表示命令用法无效.

## Commands

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
arw list issues [--all-statuses | --status <status>[,<status>...]] [--type <implementation|application-source|wayfinder>[,...]]
arw list maps
arw list specs
arw list background-agents
arw print <canonical-id>
arw open <canonical-id>
arw migrate artifacts
arw spec-readiness prepare --issue issue:<NNNN>:<NN> [--input <temp-json-path>]
arw spec-readiness generate --issue issue:<NNNN>:<NN> --input <draft-path>
arw spec-readiness promote --input <generated-path>
arw spec-readiness verify --issue issue:<NNNN>:<NN>
arw commit-audit prepare --input <absolute-input-path>
arw commit-audit verify
arw --version
```

会写入的命令是 `arw workflow init`, `arw workflow update` (不带 `--dry-run`), `arw workflow remove`, `arw text fix`, `arw migrate artifacts`, `arw spec-readiness generate`, `arw spec-readiness promote` 和 `arw commit-audit prepare`; 只在相应的独立授权工作流中运行它们. 其余命令只读. `arw migrate artifacts` 只迁移旧版 ARW Artifact 格式. 领取和解决是 Artifact 工作流规则, 不是命令.

供用户使用的短别名是 `li`, `lm`, `ls` 和 `lba`; Agent 编写的指令使用上面的规范形式.

## Command notes

- `arw list issues` 默认返回当前最前沿的 issue. 带参数使用时, 尽量结合 `rg` 等过滤工具验证期望条目或统计条目数 (排除表头和分隔行), 保留 `arw` 自身的退出码和诊断, 并区分过滤未匹配与命令失败. 只有确实需要逐项查看时才返回完整列表.
- `arw list background-agents` 只读查询当前用户跨仓库的后台环境 ([后台 Agent 列表](../../../docs/specs/agent-repository-workflow/spec.md#background-agent-listing)), 不授予分派或控制权限. `arw background-agent` 是供 Agent 工具连接的机器入口, 不属于面向用户的命令清单; 使用方式见 `reviewer-launch` Skill.
- `print` 把原始 Artifact 内容写到标准输出, 诊断写到标准错误; `open` 是供用户使用的便捷操作. 两者只接受本地 `issue:<NNNN>:<NN>`, `map:<NNNN>` 或 `spec:<NNNN>`, 拒绝限定的 issue ID, 不读取其他仓库或 Git 历史.
- `arw terms check` 使用最近的 Git 仓库根目录和即时模式的工作树, `--strict` 使用发布模式的保留要求; 两者都不写入仓库状态. 默认排除仓库根目录下的 `.scratch/**`; 重复使用 `--include` 只覆盖这一项排除, 仍受 Git 忽略规则, `.arwignore` 和其他通用排除约束. 它显示每份文档的 Chinese, English 和 Other 比例, 比例不改变诊断或退出码. 语言检查使用 `arw.config.json` 的命名规则; `--verbose` 只改变显示范围; `--language-threshold <name>=<percentage>` 可重复覆盖本次阈值, 不写配置, 重复名称, 未知名称和无效比例是用法错误. 结果按 `validation` Skill 处理.
- `arw language inspect` 只分析显式文件或目录中的 Markdown 语言组成, 不判断预期语言. 它递归展开目录, 不受 Git 跟踪状态或 `.arwignore` 限制, 不跟随符号链接, 始终排除 `.git`; 任一目标无效时整次调用失败且不显示部分结果.

## Post-init handoff

`arw workflow init` 成功后, 使用完整的 Agent Post-init Handoff, 并审计其中列出的每个就绪范围. ARW Engine 观察到的缺口是该审计的输入, 不证明不存在其他缺口.

- 根 `CONTEXT-MAP.md` 和根 `CONTEXT.md` 都不存在时, 视为领域文档缺口, 在合并的完成 issue 中加入 Repository Profile 选定的布局: `single-context` 需要结构有效的根 `CONTEXT.md` (可以没有 `## Language` 条目); `multi-context` 需要非空的根 `CONTEXT-MAP.md` 及其标识的每个 `CONTEXT.md`. `workflow init` 本身不创建这些文档.
- Repository-owned 规则与已安装的 Workflow Distribution 冲突时, 以 Workflow Distribution 为准. 检查与其责任重叠的每条 Agent 指令, 删除或重写冲突的 Repository-owned 规则, 删除语义重复项, 保留不冲突的规则. 现有权威无法判定是否冲突时, 停止受影响的工作并询问用户.
- 完整审计没有缺口时不创建 issue. 仍有缺口时, 精确创建一个合并的仓库工作流完成 issue, 包含全部领域文档, 验证, 写作, `.arwignore`, 记录迁移, 受管理区域, 语义去重和 Code Map 工作, 并在普通实施前完成它.
- 审计每个由 Agent 管理的文档或规划记录路径中使用本地语言的文件名, 为每个需要决定的路径建议一个英文文件名. 还缺少任何文件名选择时, 合并 issue 设为 `Status: needs-info`. 用户可以接受建议, 换成另一个英文文件名, 保留当前名称, 或一次选择保留全部当前名称. 记录全部选择并解决其他阻断项后, 才改为 `Status: ready-for-agent`.
- 每个保留的当前文件名, 在 `docs/agents/writing.md` 的 Repository-owned 区域添加明确例外, 记录精确路径, 当前标题路径和替代内容规则. 例外只适用于经过审查的现有文件, 文件删除或重命名后删除该例外, 不授权未来文档使用本地语言文件名.
