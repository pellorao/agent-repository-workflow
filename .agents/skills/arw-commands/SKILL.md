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
arw terms check [--strict] [--include <repository-relative-directory>]...
arw language inspect <repository-relative-path>...
arw module check-correction <local-module-issue-id>
arw list issues [--all-statuses | --status <status>[,<status>...]] [--type <implementation|application-source|wayfinder>[,...]] [--full]
arw list maps [--full]
arw list specs [--full]
arw list background-agents [--full]
arw print <canonical-id>
arw open <canonical-id>
arw migrate artifacts
arw spec-readiness prepare --issue issue:<NNNN>:<NN> [--input <temp-json-path>]
arw spec-readiness generate --issue issue:<NNNN>:<NN> --input <draft-path>
arw spec-readiness promote --input <generated-path>
arw spec-readiness verify --issue issue:<NNNN>:<NN> [--subject-only]
arw commit-audit prepare --input <absolute-input-path>
arw commit-audit verify [--non-implementation]
arw --version
```

非交互 `arw workflow init` 要么用 `--reuse-profile`, 要么给出完整 Profile 替换: `--platform`, `--domain-layout` 和三个 `--code-map-*` 必须一起给出, 选项不带值表示空列表, 例如:

```text
arw workflow init --non-interactive --platform codex --platform claude-code --domain-layout single-context --code-map-root --code-map-include --code-map-exclude
```

会写入的命令是 `arw workflow init`, `arw workflow update` (不带 `--dry-run`), `arw workflow remove`, `arw text fix`, `arw migrate artifacts`, `arw spec-readiness prepare`, `arw spec-readiness generate`, `arw spec-readiness promote` 和 `arw commit-audit prepare`; 只在相应的独立授权工作流中运行它们. 其余命令只读. `arw migrate artifacts` 只迁移旧版 ARW Artifact 格式. 领取和解决是 ARW Artifact 工作流规则, 不是命令.

供用户使用的短别名是 `li`, `lm`, `ls` 和 `lba`; Agent 编写的指令使用上面的规范形式.

## Command notes

- `arw list issues` 默认返回当前最前沿的 issue. 带参数使用时, 尽量结合 `rg` 等过滤工具验证期望条目或统计条目数 (排除表头和分隔行), 保留 `arw` 自身的退出码和诊断, 并区分过滤未匹配与命令失败. 只有确实需要逐项查看时才返回完整列表. `li`, `lm`, `ls`, `lba` 和 `jl` 默认按 100 列截断名称列 (`Title`, `lba` 为会话标题); 过滤, 计数或读取完整名称时加 `--full | -f`.
- `arw list background-agents` 只读查询当前用户跨仓库尚未确认退出的后台环境, 不启动管理进程或模型, 也不授予分派或控制权限; 管理进程未运行时显示 `The manager process is not running; ...` 并返回 `0`. `arw background-agent` 是供 Agent 工具连接的机器入口, 不属于面向用户的命令清单; 使用方式见 `reviewer-launch` Skill.
- `print` 把原始 ARW Artifact 内容写到标准输出, 诊断写到标准错误; `open` 是供用户使用的便捷操作. 两者只接受本地 `issue:<NNNN>:<NN>`, `map:<NNNN>` 或 `spec:<NNNN>`, 拒绝限定的 issue ID, 不读取其他仓库或 Git 历史.
- `arw terms check` 使用最近的 Git 仓库根目录和即时模式的工作树, `--strict` 使用发布模式的保留要求; 两者都不写入仓库状态. 默认排除仓库根目录下的 `.scratch/**`; 重复使用 `--include` 只覆盖这一项排除, 仍受 Git 忽略规则, `.arwignore` 和其他通用排除约束. 结果按 `validation` Skill 处理.
- `arw language inspect` 只分析显式文件或目录中的 Markdown 语言组成, 不判断预期语言. 它递归展开目录, 不受 Git 跟踪状态或 `.arwignore` 限制, 不跟随符号链接, 始终排除 `.git`; 任一目标无效时整次调用失败且不显示部分结果.

## Post-init handoff

`arw workflow init` 成功后, 读取 `./post-init-handoff.md` 并按它审计.
