# 慢测试改用 mock, 每个真实边界只保留极少数真实运行

Status: completed

## What to build

维护者 2026-11-02 对 issue 0025:02 的决定: 不改生产代码, 用 mock 让测试降到 100 毫秒以下; "大幅度利用 mock 来优化测试时间. 比如上千个测试用例, 可能就只需要实际运行一次 git, 其他全部用 mock 替代"; "绝对不要因为测试耗时问题而改生产. 如果实在做不到 100ms 以下, 那么就让它超过算了."

范围只含 `tests/` 下的测试文件和测试辅助代码. 对 Git, 子进程, 安装, 守护进程等每个真实边界, 只保留极少数 (通常一个) 真实运行的案例, 其余案例改用 mock 或进程内测试, 被证明的行为不变. 不改生产代码, 也不为测试加注入点. mock 做不到 100 毫秒以下的案例保留原样并记录: 维护者 2026-11-02 已决定, 不改生产代码就无法降到 100 毫秒以下的案例允许超过阈值, 原话 "如果实在做不到 100ms 以下, 那么就让它超过算了", 且无需就这类案例再询问. 这些案例的名称与耗时列在 `## Comments`.

维护者的约束 "绝对不要因为测试耗时问题而改生产" 使没有 Git 注入点的调用方在本 issue 中保留真实 Git: `commit-audit` (`lib/commit-audit/commit-audit.mjs:141`, `:155`, `:171`, `:174`, `:283`, `:336` 硬编码 `createNodeGitRunner(repositoryRoot)`) 和 `spec-readiness` (`lib/spec-readiness/spec-readiness.mjs:435`, `:452`, `:481` 同样硬编码, `lib/arw.mjs` 的 `SpecReadinessDependencies` 不暴露 Git). 用 `mock.module` 在 spawn 层替换这两个库的 Git 另作后续评估, 不在本 issue 内. 其余已有注入点的调用方 (Repository Workflow, application-jira 的 module correction check 与 JIRA 同步, artifact-migration) 都转换为替身.

体积预算: 非测试代码净增 0 行 (只改测试).

预期验证: `pnpm test` 三次 (记录墙钟中位数与超过 100 毫秒的回调), `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `git diff --check`.

## Acceptance criteria

- [x] 超过 100 毫秒的回调数比基线显著减少, 改动前后的耗时记录在 `## Validation`.
- [x] 每个真实边界保留的真实运行案例列在 `## Comments`, 每个仍超过 100 毫秒的案例写明原因.
- [x] 生产代码无改动; 案例总数不减少 (被合并或删除的案例逐个说明替代覆盖).
- [x] 上述验证命令全部通过.

## Blocked by

- None - can start immediately

## Validation

- 口径: 阈值判断以隔离口径为准, 即每个测试文件单独运行时的回调耗时 (三次取中位数). 整套件并发口径的回调耗时约为隔离口径的 2 倍, 受 32 核 CPU 争用影响, 同一案例三次之间波动大, 回调数只作参考.
- 基线 (改动前, 自定义报告器读取 `test:pass` 的 `duration_ms`, `node --test` 三次): 墙钟 3.12, 3.13, 3.12 秒, 中位数 3.12 秒 (`pnpm test` 单次 3.45 秒); 839 个通过 (含 `test-reporter.mjs` 入口一项); 隔离口径超过 100 毫秒的有 29 个; 并发口径 62 个. 并发口径前几名 (毫秒): 334 root Installer completes from a single piped answer line, 256 init blocks configured targets excluded, 239 submodule fast-forward, 229 pool view of Spec Readiness, 224 Spec Readiness CLI lifecycle, 222 a Claude Code Main starts and waits, 210 a CRLF checkout, 204 workflow update reports removed deprecated config fields.
- 结束 (第 2 轮审核修改后重测, 同口径三次): 墙钟 2.73, 2.75, 2.73 秒, 中位数 2.73 秒; `pnpm test` 三次 (`duration_ms`) 2.77, 2.74, 2.77 秒; 均 841 个通过, 0 失败 (比基线多 2 个案例, 即 Git 替身对照的两个案例, 见 `## Comments`). 隔离口径超过 100 毫秒的降到 5 个 (见 `## Comments`); 并发口径 43, 41, 43 个 (仅供参考).
- 定向耗时 (单文件隔离, 毫秒): `workflow.test.mjs` 的 12 个案例原 106 到 148, 现均低于 92 (两个真实 Git 案例约 52 和 66); `repository-workflow/cli.test.mjs` 的 4 个案例原 113 到 161, 现均低于 51; `application-jira/cli.test.mjs` 与 `artifact-migration/cli.test.mjs` 现各案例均低于 75 (见 `## Comments` 的真实 Git 案例); installation 的 `rejects invalid arguments` 117 到 71, `Installation Payload applies ordinary unsafe-source failure to LICENSE.txt` 110 到约 3, `installation rejects linked runtime directories` 106 到约 10; `reviewer-capability-setup.test.mjs` 两个入口案例 90 到约 45; `release-vm` 的 `--previous` 案例约 60 到 21; 两个 Git 替身对照案例各约 50 和 65.
- 命令: `node --test --test-reporter=<scratchpad>/dur-reporter.mjs` (整套件三次, 逐文件隔离三次), `pnpm test` 三次, `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `git diff --check`, `node arw.mjs text check`, `node arw.mjs terms check --include .scratch/0039-mock-slow-tests/` 全部通过. 生产代码无改动 (只改 `tests/` 和本 issue 文件).
- Spec Readiness: 按 Exception workflow 记录 `not-applicable`.

## Comments

改动范围只含 `tests/` 和本 issue 文件.

Git 替身: `tests/helpers/mock-git.mjs` 是唯一的进程内 Git 替身, 按内容哈希记录 index 与 HEAD 和线性提交历史 (提交时间取 `GIT_COMMITTER_DATE`, 缺省为递增值). 它回答 `init`, `config`, `add` (`-A`, `.`, 路径), `commit` (含 `-a`), `write-tree`, `ls-files` (`--cached`, `--stage`, `--others`, `--exclude-standard`, 路径限定), `ls-tree` (`-r`, 路径限定), `status`, `check-ignore`, `cat-file --batch` 与 `cat-file -e HEAD:path`, `diff --cached`, `diff --quiet -- path`, `rev-parse` (`--show-toplevel`, `--verify [--quiet] HEAD[^{commit}]`, `--is-shallow-repository`), `rev-list --reverse --topo-order HEAD [-- path]`, `show -s --format=%ct`, 其他命令一律失败. 忽略规则只支持普通名和 `name/` 目录名, 遇到其他写法直接抛错. 入口有三种: 旧的 `createMockGitRepository`/`createMockGitRunCommand` (`runCommand` 形状), `createMockGit().runnerFor(root)` 与 `createMockGitHandle(root)` (生产 `GitRunner` 形状), 以及 `installGitDiscovery` (只回答 `rev-parse --show-toplevel` 的 PATH 假 `git`, 其余命令失败).

Git 句柄随仓库一次决定: `tests/helpers/arw-cli.mjs` 的 `createRepository` 默认真实 Git, 返回 `{root, programDirectory, git}`; `createRepositoryWithMockGit` 返回同形状但 `git` 为替身句柄. `git` 句柄含 `commitAll(message, {environment})`, `git(argv, {environment})` 和 `runner`. `workflow.test.mjs`, `repository-workflow/cli.test.mjs`, `application-jira/cli.test.mjs` 与 `artifact-migration/cli.test.mjs` 都读该句柄 (后两者经文件内的 `run` 包装把 `git.runner` 交给 `applicationJiraDependencies`/`workflowDependencies`/`artifactMigrationGit`), 不再有按路径判断真实或替身的检查.

替身对照 (案例数 839 到 841 的唯一变化, 没有案例被删除或合并): `tests/helpers/test-helpers.test.mjs` 的两个案例用同一组操作分别驱动一个真实仓库和替身仓库, 逐步比较输出与退出码.

- `Git double stages, commits and answers status, ignore and write-tree like a real Git process`: `status --porcelain=v1 -z --untracked-files=all` 与 `ls-files --cached --full-name -z` 在初始, `add <path>`, `add -A`, `commit`, 修改与删除后, `commit -a`, 再 `add <path>` 之后都一致; 两种 `check-ignore` 一致. `write-tree` 比较相等语义: 对 "index 未变" 与 "index 变化" 两种情况, 断言 `(真实前后 id 相等) === (替身前后 id 相等)`, 并断言前者为相等, 后者为不等; 不比较字面哈希.
- `Git double answers path inventories and history like a real Git process`: 未出生 HEAD 的 `rev-parse --verify --quiet HEAD` (退出码 1), `ls-files --stage`, `--others --exclude-standard`, `--cached --others`, `diff --quiet`, `ls-tree` (递归, 文件, 缺失路径), `cat-file -e`, `--is-shallow-repository` 的输出一致; 两次带不同提交时间的提交后, `rev-list --reverse --topo-order HEAD [-- path]` 经 `show -s --format=%ct` 得到的时间序列与真实 Git 一致.

保留的真实运行 (每个边界, 其余案例改用替身或进程内调用):

- Repository Workflow 的 Git 事实 (`workflow.test.mjs`, 其余 28 个案例用替身): `tracked target later excluded by .gitignore` (真实 `check-ignore` 对已跟踪文件) 和 `update blocks dirty state and invalid Reviewer settings without changing the lock` (真实 `status` 报告未暂存修改).
- Repository Workflow CLI (`repository-workflow/cli.test.mjs`): `workflow update dry-run reports diagnostics without serializing its internal plan` (真实 `git-visible-untracked`); 其余用替身加假 `git` 做仓库发现.
- application-jira CLI (`application-jira/cli.test.mjs`): module correction check 其余 5 个案例, JIRA list, open, print, accept, complete, submodule switch-branch 与 `Workflow init, update, and verify validate Repository Application configuration ...` 改用替身 (accept 与 complete 原本只用来创建仓库, Git 由案例自带的桩回答). 保留真实 Git 的案例及原因:

| 案例 | 原因 |
|---|---|
| `Module correction check reads HEAD and current files without Application configuration or writes` | 注入点 (`dependencies.git`) 边界的真实运行: 真实 index, HEAD 与工作区三者并存时的读取 |
| `Application sync converges configured Modules and leaves status replacements unstaged` | `runApplicationSyncCommand` 硬编码 `createNodeGitRunner` (`application-jira-cli.mjs:346`) |
| `Application sync reports completed operations and rollback for a multi-Module transaction failure` | 同上, 另含真实 Module 仓库的 `ls-files --stage` 回滚核对 |
| `Application sync blocks deleted or de-associated index records before Module convergence` | 同上, 真实 `git rm`, `restore` |
| `Application associate writes bidirectional fields through two Repository transactions` | 关联命令硬编码 `createNodeGitRunner` (`:483`, `:497`), 真实 Module 仓库 |
| `Application associate analyzes every configured Module and protects each affected effort baseline` | 同上 |
| `Application associate reports recovery for the failed and previously written Repositories` | 同上 |

- artifact-migration (`artifact-migration/cli.test.mjs`, 14 个案例中 12 个改用替身, 含原先用桩的 shallow 案例): 保留 `update migrates the complete scratch tree and is idempotent` (真实 `rev-list`, `cat-file -e`, `add`, `commit` 的端到端运行) 和 `artifact migration orders effort numbers by reachable commit history and UTF-8 slug bytes` (真实提交时间戳与拓扑序).
- effort-start (`arw-common/effort-start.test.mjs`, 1 个案例, 21 次真实 Git): `effort start is the parent of the earliest effort commit, the empty tree for a root commit, or base for an uncommitted effort` 保留真实 Git. 被证明的行为是 Git 自己对 `:(glob).scratch/N-*/**` 路径规格的 `log --reverse --format=%H %P` 求值与根提交的父提交; 替身要重新实现 glob 路径规格与逐提交的父子关系, 那样断言的就只是替身本身.
- 没有注入点的库, 保留真实 Git (按上文 What to build 的约束, `commit-audit` 与 `spec-readiness` 硬编码 `createNodeGitRunner`). 下表的 "Git 次数" 为该案例单独运行时的真实 `git` 进程数, 含 fixture 的 `git init`, `add`, `commit`. 另 `spec-readiness.test.mjs` 中 9 个不走 `prepare` 的案例没有读取 Git 的路径, 已改为无 `.git` 的临时目录 (`createRepository(t, {git: false})`), 不再 `git init`.

| 文件 | 案例 | Git 次数 |
|---|---|---|
| `commit-audit/cli.test.mjs` | `Commit Audit CLI keeps explicit absolute Request handles` | 0 |
| | `prepare writes a fixed-version round for both Reviewers and follows up their threads in the next round` | 21 |
| | `prepare points both Reviewers at the Comments ledger of every authorizing issue` | 11 |
| | `prepare adds Gate 1 for terminal transitions and Gate 2 documents changed since the effort start` | 18 |
| | `Gate 1 also covers an issue moving from wontfix to completed` | 17 |
| | `Gate 2 documents are only the changed governing documents of this effort, so an unchanged effort needs no exception` | 31 |
| | `prepare rejects changed paths under another effort` | 9 |
| | `verify ignores Wayfinder tickets, preserves registered identities, and allows descriptive slug renames` | 21 |
| | `verify --non-implementation accepts planning records and rejects other or malformed staged content` | 32 |
| | `verify --non-implementation lets an issue without a readiness record complete, any issue become wontfix, and rejects wontfix to completed with a readiness record` | 25 |
| | `verify --non-implementation accepts a candidate of only Agent rule and documentation Markdown` | 29 |
| | `verify requires a review round whose HEAD and tree match the staged candidate` | 49 |
| | `verify accepts only issue record changes and rejects Status or review subject changes of an authorizing issue` | 38 |
| | `verify takes each Reviewer report from the latest non-empty round and resolves the session round for both platforms` | 50 |
| | `verify --non-implementation rejects non-canonical effort directories and NUL Markdown, and keeps checking after an Artifact error` | 20 |
| `spec-readiness/cli.test.mjs` | `spec readiness prepare accepts JSON stdin and emits a minimal reviewer request` | 5 |
| | `spec readiness prepare reports precheck warnings on stderr and keeps stdout to the round directory` | 5 |
| | `spec readiness prepare accepts the shared JSON schema from an input file` | 5 |
| | `spec readiness rejects an issue in duplicate effort identities` | 2 |
| | `spec readiness CLI covers immutable request, generate, promote, verify, and exception lifecycle` | 15 |
| `spec-readiness/spec-readiness.test.mjs` | 24 个经 `prepare` 的案例, 每个 4 到 12 次 (`complete lifecycle ...` 4, `each implementation issue owns an independent Spec Readiness sidecar` 7, `prepare creates a new immutable complete Reviewer Request path` 7, `prepare activation failure removes the new request and preserves the prior active request` 7, `promotion rejects identity, schema, and generated-path mutations` 12, 其余 4 到 8) | 4 到 12 |

`commit-audit` 的案例, 除第一个外, 都由生产代码内部的 `createNodeGitRunner` 读取真实 index, HEAD 与提交历史 (`git` 命令是被测行为本身: 暂存候选, 提交树匹配, 路径规格). 为这两个库做 `mock.module` 的 spawn 层替身需要实验性开关加一整套 Git 对象模型, 是另一个单独的决定, 由 Main 另行提出.

其余仍含真实 Git 的文件次数都不高 (约 13 到 40 次, 主要是每个 CLI 调用的真实仓库发现 `rev-parse --show-toplevel`, 该发现没有注入点, 用 PATH 假命令也是一个进程, 加每个案例一次 `git init`): `arw-common/artifact-cli`, `document-terms-cli`, `agent-cli`, `text-cli`, `document-terms`, `repository-state-inspector`, `submodule-git-integration` (真实 submodule 与裸远程, 保留). 它们没有转换, 收益只是个位数毫秒, 若 Main 要求再逐个转换.

安装与 Installer (`installation.test.mjs`), 真实进程案例及原因:

- `:175` `root Installer rejects invalid arguments before runtime identity observation`: 只复制 `install.mjs` 和 `lib`, 不含 `package.json`. 被证明的行为是新进程在 import 时加载 `lib/arw-common/identity.mjs` 的 `package.json`, 在此之前就以退出码 2 拒绝参数, 只有真实新进程才能证明 "先于 identity 观察", 进程内调用无法复现 import 时序.
- `:190` `root Installer maps prompt EOF to one stable pre-write error`: 真实 stdin 管道 EOF.
- `:199` `root Installer completes from a single piped answer line`: 真实 stdin 单行回答完成完整安装.
- `:526` `first installation copies the complete runtime and executes the installed command independently of the source checkout`: 真实首次安装后运行已安装的 `terms check`, 证明安装物脱离源码仓库独立运行.
- `:1705` `installed CLI combines Repository Application configuration with global JIRA display configuration`: 已安装 CLI 的真实进程, 运行 `jira list` 合并配置.
- `:1753` `real Installer installs current Source Checkout bytes without Git evidence and installed CLI reads manifest version`: 真实 Installer 安装当前 Source Checkout 字节, 运行 `--version`.
- 其余安装案例原本就是进程内调用.

脚本入口没有可调用的 main (顶层读取 `process.argv`, 模块不导出任何函数), 因此案例保留真实进程, 同一案例内的多个进程已并行:

- `release-vm.test.mjs:9` `release-vm check forwards --previous to the guest check on every Node.js executable` (成功分支转交 `--previous`).
- `release-vm.test.mjs:33` `release-vm check rejects a missing or malformed --previous value with a usage error`: 三种写法 (缺值, `v0.5.0` 非十六进制, `abc12` 过短) 是同一条正则校验的三个不同类别, 各自一个真实进程.
- `reviewer-capability-setup.test.mjs:47` `the entry maps results to exit codes` (未知命令 2; 被阻断的 score 1 加 JSON) 和 `:57` `the entry parses the repeatable options and the cell lists` (`summary --markdown` 阻断为 1; `summary --cell` 缺参数为 2).

其余未改动的真实边界: `installed uninstall command executes through the real CLI entry point`, `root arw entry executes ...`, `submodule-git-integration`, `pool view` 和 `setup` 的 Spec Readiness 案例, `claude-sessions` 的 fake-claude 进程, `test-reporter` 的 `node --test` 子进程.

仍超过 100 毫秒的案例 (隔离口径, 三次中位数, 毫秒). 依据维护者 2026-11-02 的决定 (见 `## What to build`: 不改生产代码就做不到 100 毫秒以下的案例允许超过阈值, 原话 "如果实在做不到 100ms 以下, 那么就让它超过算了", 无需再询问), 这五个案例保留原样:

| 案例 | 中位数 | 原因 |
|---|---|---|
| `root Installer completes from a single piped answer line` | 270.2 | 真实完整安装, 复制全部运行时文件 |
| `root Installer maps prompt EOF to one stable pre-write error` | 139.1 | 真实 Node 进程启动加载安装模块, 约 125 毫秒启动成本 (`NODE_COMPILE_CACHE` 试过, 无收益) |
| `pool view of Spec Readiness stages one view and redacts the Request` | 105.7 | 生产代码内部直接 `spawn git` 暂存真实 fixture, 无注入点 |
| `Installation Payload Interface returns the canonical platform payload without package metadata` | 102.3 | 读取并校验真实源码树 (lib 与 distribution 共约 3 MB) |
| `a cold paused Reviewer retains its early-exit count and does not replay ended turns or pause notices` | 100.8 | 已使用脚本化原生会话, 剩余成本是状态库的真实文件系统读写 |

接近阈值 (隔离口径中位数): `format-penalty` 的 code-standards haiku-1 96.8, haiku-3 93.7, haiku-4 90.6 (评分计算的纯 CPU 成本, 并行化无收益, 已回退), `spec readiness CLI covers immutable request...` 93.9, `production Submodule Coordination fast-forwards a real configured submodule from a bare remote` 93.5, `a Claude Code Main starts, waits for ...` 93.3, `Codex configuration lifecycle preserves user bytes ...` 91.9.

整套件墙钟从 3.12 降到 2.73 秒, 因为瓶颈是 32 核上各测试文件加载模块的 CPU 争用和最长文件 (`format-penalty`, `installation`), 而不是 Git 进程; 效果主要体现在回调数和逐文件耗时上.
- 台账: `.scratch/0039-mock-slow-tests/issues/01-mock-slow-tests.md` What to build 范围 转入后续 issue 提交审核第 3 轮要求符合审核认为 commit-audit 与 spec-readiness 保留真实 Git 未获维护者确认; 不改生产代码时只能用 `mock.module` 替换, 测量与评估转入 `02-mock-module-git.md`.
- 台账: `## Comments` spec-readiness 库案例表 记录不修 第 3 轮要求逐案列出 24 个经 `prepare` 的案例名称; 属记录完整性, 不影响测试行为, 案例均在 `tests/spec-readiness/spec-readiness.test.mjs`.
- 台账: What to build "有注入点" 的范围 记录不修 第 3 轮指出范围列举未含 `deriveEffortStart` 的 `git`, 且与保留的少数真实案例 (module correction check, artifact-migration 两例, effort-start) 的口径不一致; 这些保留案例的理由已在本节逐条写明, 属措辞, 不影响行为.
- Main 处置 (第 2, 3 轮要求符合审核关于超过 100 毫秒案例的批准): 不采纳. 维护者 2026-11-02 的原话 "绝对不要因为测试耗时问题而改生产. 如果实在做不到 100ms 以下, 那么就让它超过算了" 就是对这类案例的决定, 用户级规则优先于 ARW 规则 (根 `AGENTS.md` Rule Conflicts); 五个案例和中位数已列在上面, 也已在状态页告知维护者.
