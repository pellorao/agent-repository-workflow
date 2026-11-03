# 更正 Claude Reviewer git 放行规则的注释

Status: completed

## What to build

全量审核 (fullreview I1) 怀疑 Claude Reviewer 的 `Bash(git diff:*)` 放行规则会让恰有两个路径参数的 `git diff` 隐式进入 no-index 模式, 读到仓库外文件, 而 `--no-index` 的 deny 规则不匹配. 2026-11-04 用 Claude Code 2.1.317 按 Claude 后端的确切参数 (含 `--setting-sources ''`, `--permission-prompt-tool stdio`, 放行规则与 deny 规则) 对 haiku 实跑复现: `git diff` 的路径参数在仓库外时 (绝对路径, `..` 相对路径, `-C` 形式, `--stat`, `/dev/null`, `?` 通配, 花括号展开, 引号, 变量) Claude Code 自身的路径检查都不按放行规则自动执行, 而是作为 `can_use_tool` 请求交给管理进程, 管理进程对 Reviewer 的所有此类请求一律拒绝; 显式 `--no-index` 由 deny 规则直接拒绝. `git diff <base> <tree>`, `git show <tree>:<path>` 和 `git -C <工作目录> diff ...` 照常自动放行. 所以不存在要修的行为缺陷, 只剩两处注释把这道边界写得不准确.

只改注释, 不改任何代码, 测试, 规范或 ADR: Claude 后端放行规则处的注释 (现称 "Read-only git commands", 未说明 `--no-index`, 也未说明路径参数的来源保护) 改为写明三点: allow 规则按命令前缀匹配, 所以 `git -C <路径>` 只在精确工作目录时放行; `--output` 会写文件, `--no-index` 会读任意路径, 二者由 deny 规则拒绝; 其余命令的路径越界由 Claude Code 自带的路径检查转为权限请求, 再由管理进程拒绝, 这依赖 Claude Code 的该行为 (已在 2.1.317 上实测). Reviewer 可用 git 命令常量的注释同步为同样的事实, 不再称这些命令 "read-only" 而不加限定.

体积预算: 非测试代码净增 0 行 (只改注释, 注释的行数不计代码); 不新增测试, 因为 Claude Code 的路径检查不在 ARW 内, 确定性测试无法观察它.

预期验证: `git diff` 观察只有两个源文件的注释行变化, 其余文件除本 effort 的 `.scratch` 工件外无改动; 运行 Claude 后端测试文件, `node arw.mjs text check` 和 `pnpm typecheck`.

## Acceptance criteria

- [x] 用 `git diff` 观察, 除本 effort 的 `.scratch` 工件外只有 Claude 后端放行规则处和 Reviewer git 命令常量处的注释行变化, 没有代码, 测试, 规范, ADR 或规则文档的变化.
- [x] 两处注释写明: allow 规则按前缀匹配并限定 `-C` 的路径; `--output` 与 `--no-index` 由 deny 规则拒绝; 仓库外路径由 Claude Code 自带路径检查转为权限请求并由管理进程拒绝, 这一依赖已在 Claude Code 2.1.317 实测.
- [x] Claude 后端测试文件, `node arw.mjs text check` 与 `pnpm typecheck` 通过.

## Blocked by

- None - can start immediately

## Validation

- `git diff --stat`: 除本 effort 的 `.scratch` 工件外只有 `lib/background-agent/claude-sessions.mjs` 和 `lib/arw-common/reviewer-configuration.mjs` 的注释行 (+3 -3), 无代码, 测试, 规范, ADR 或规则文档变化. 两处注释已写明前缀匹配与 `-C` 限定, `--output` 与 `--no-index` 的 deny, 仓库外路径由 Claude Code 路径检查转为权限请求并由管理进程拒绝 (Claude Code 2.1.317 实测).
- `node --test tests/background-agent/claude-sessions.test.mjs`: 9 项通过. `node arw.mjs text check`, `node arw.mjs terms check --include .scratch/0066-claude-reviewer-git-comments/`, `pnpm typecheck`, `node arw.mjs spec-readiness verify --issue issue:0066:01`: 均通过.
- 体积 (`commit-audit prepare` 实测): 代码 0 行 (2 个文件), 文档 0 字符, 测试 0 行.

## Comments

- 复现依据 (Main Agent 授权的 worker 实跑, 约 2 次 haiku low 运行, 费用几分钱): 临时仓库与仓库外无害文件, 以 Claude 后端的确切参数运行 `claude -p`. 基线运行: 放行规则含 `git diff`, 驱动对所有 `can_use_tool` 请求按命令是否含仓库外路径决定回复. 结果: 7 种形式中仓库外路径的 `git diff` (绝对, `..` 相对, `-C` 形式) 都以 `can_use_tool` 请求到达驱动, 没有自动执行; `--no-index` 被 deny 规则直接拒绝; `git diff <base> <tree>`, `git show <tree>:f.txt` 和 `git -C <cwd> diff <base> <tree>` 自动执行. 补充运行: `--stat`, `/dev/null`, `?` 通配, 花括号展开 (请求原因 "Brace expansion"), 引号和 `..` 相对路径同样以请求到达; 含 `$OUTDIR` 变量的形式以请求到达 (原因 "A variable in this command can't be checked before it runs"). 管理进程的 `declineReviewerInteractions` 对 Reviewer 的 `can_use_tool` 一律回复拒绝.
- 没有实跑验证 "`--settings` 的 ask 规则在 `--setting-sources ''` 下是否覆盖内置放行": Claude Code 已自行路由, 该方案 (fixplan 选项 G) 不需要.
- Main Agent 的判断 (本 issue 不含设计决定): 不改代码和规范, 不单独记录治理设计, 按总层规则对不含设计决定的单 issue effort 记录 `not-applicable` 例外.
