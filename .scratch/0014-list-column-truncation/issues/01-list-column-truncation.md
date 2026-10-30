# list 命令按列截断与 --full 选项

Status: completed

## What to build

按用户 2026-10-30 的要求, 实现 [spec:0014](../spec.md) 的 Behavior 与 Module Design: `arw li`, `lm`, `ls`, `lba`, `jl` (及其规范形式) 默认按 100 列截断名称列, `--full | -f` 输出全文.

同步更新长期文档, 只改与本行为相关的句子: `docs/specs/agent-repository-workflow/spec.md` 的 CLI interface 命令清单, `arw list issues` 选项段, maps/specs 段, Background Agent listing 中 "不接受筛选参数或其他选项" 与 "`Main session` 始终同时显示完整 session ID 和会话标题"; `docs/specs/agent-repository-workflow-application-jira/spec.md` 的 `jira list` 用法与输出段中 "标题不截断"; `README.md`, `README.zh-CN.md` 与 `docs/manuals/**` 中这些命令的用法; `.agents/skills/arw-commands/SKILL.md` 的命令清单和用法说明 (Agent 需要过滤, 计数或读取完整名称时使用 `--full`); `.agents/skills/application-workflow/references/jira-acceptance.md` 中 `jira list` 的调用. `lib/arw.mjs` 的无参数用法说明在各命令处列出 `--full | -f`. 分发副本和 `.claude` 投影由 Main 同步.

验证: `pnpm test`, `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `node arw.mjs text check`, `node arw.mjs terms check --include .scratch/0014-list-column-truncation/`, `git diff --check`. 测试覆盖: 不截断时输出与现状相同; 名称超长时截到上限并以 `...` 结尾, 宽字符按 2 列且不切开字素, 截断后整行不超过 100 列; 其他列很宽时名称保留 16 列; `lba` 只截标题, 保留 session ID; 各命令 `--full` 与 `-f` 输出全文, 可与已有选项组合; `lba` 其他选项仍为用法错误. 新增或语义修改测试后按 `test-performance-optimization` Skill 测量回调耗时. 不修改后台 Agent 管理进程行为.

预估非测试代码净增约 +45 行; 文档净增约 1000 字符.

## Acceptance criteria

- [x] 五个列表命令默认只截断名称列, 截断结果以 `...` 结尾, 整行不超过 100 列 (其他列超宽时除外, 名称至少 16 列); 未超长的输出与现状相同. 观察: 测试.
- [x] `lba` 只截断会话标题, 保留完整 session ID. 观察: 测试.
- [x] `--full | -f` 在五个命令上输出全文并可与已有选项组合; `lba` 只接受该选项. 观察: 测试.
- [x] 无参数用法说明列出 `--full | -f`. 观察: 测试或用法输出.
- [x] 长期规格, README, 手册与 Skill 记录新行为, Skill 中需要完整名称的调用使用 `--full`. 观察: 文档差异.
- [x] 完整验证命令通过. 观察: Validation 的实际命令结果.

## Blocked by

- None - can start immediately

## Validation

- 代码: `lib/common/text-table.mjs` 的 `formatTextTable` 增加 `{flexColumn, width, suffixes}`; `lib/arw-common/artifacts.mjs`, `lib/background-agent/presentation.mjs`, `lib/application-jira/jira-presentation.mjs` 传入 `full`; `lib/arw.mjs` 与 `lib/application-jira/application-jira-cli.mjs` 解析 `--full | -f` 并更新用法说明. `text-table.mjs` 导出 `listTableOptions(flexColumn, full, suffixes)` 统一默认 100 列与 `full` 判断; `renderBackgroundAgents` 的 `full` 必填, 根目录 `uninstall.mjs` 的停止确认表传 `true` 保持全文. 非测试代码净增约 42 行 (预估 45).
- 测试: 新增 `tests/common/text-table.test.mjs` (不截断时不变, 截断与 `...`, 宽字符与 ZWJ 字素, 16 列下限, 后缀保留, 各呈现默认截断与 `full`); 扩充 `tests/arw-entry.test.mjs` 的解析与用法断言, `tests/application-jira/cli.test.mjs`, `tests/background-agent/presentation.test.mjs`. 新增与修改的回调均低于 20 毫秒.
- 文档: 总长期规格 CLI interface 与 Background Agent listing, Application 长期规格 `jira list` (只写标题列可截断并引用总规格规则), `README.md`, `README.zh-CN.md`, `docs/manuals/application-jira.md` 与中文版, `arw-commands` Skill, `jira-acceptance.md`; Main 同步分发副本与 `.claude` 投影.
- `pnpm test`: 809 个测试全部通过; `pnpm typecheck`, 三个生产检查脚本, `node arw.mjs text check`, 本 effort 的 terms check 与 `git diff --check` 通过. 实际输出: `arw lba` 每行 100 列, 标题截为 16 列; `arw li -a` 标题截到 52 列.

## Comments

- Spec Readiness 共 4 轮: 补被替代的两句现行合同, `lba` 后缀与上限公式, 用法说明, `formatTextTable` 与 `full` 的 Interface, 16 列下限与后缀处理的理由及其算例.
- Commit Audit 第 1 轮 7 个问题全部修复: 列宽公式重复, 默认宽度与 `full` 分支三处重复, 仅接受 `--full` 的判断重复, 一次性默认选项常量, 变量命名, Application 规格复制截断规则, `uninstall.mjs` 停止确认表超出范围被截断.
- Commit Audit 第 2 轮: Application 规格的引用锚点改为总规格 `ARW Artifact operations`.
