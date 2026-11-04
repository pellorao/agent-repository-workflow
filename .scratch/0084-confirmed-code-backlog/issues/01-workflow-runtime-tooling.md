# 工作流, 审核运行层与工具的已确认积压修复

Status: completed

## What to build

按 Claude 于 2026-11-04 定稿的积压清单合并 M1 到 M6, 在 M2 后实施 M3. 禁止修改 lib/background-agent/**, 排除 M1 的 Claude 长路径会话定位项. M1, M2, M4, M6 属明确授权的缺陷修复, M3, M5 保持行为. 不修改长期规范或 Reviewer 规则.

本 issue 不含设计决定. Claude 于 2026-11-04 明确确认不需要治理设计, 使用 Spec Readiness 的 not-applicable 例外.

体积预算: 非测试代码净减约 40 行; 按本轮新增与删除合计口径, 预计代码 450 行, 测试 450 行, issue 和记录 100 行, 合计约 1000 行. 不为凑数扩大范围.

### M1

修复四个已核实, 互不依赖的小型正确性缺陷, 不改变任何公开 Interface 或持久格式:

- 仓库作用域文件系统以替换模式写入已有文件时, 调用方未指定文件模式就保留原文件的权限位. `arw text fix` 修复可执行文本文件 (如 `.sh`) 后不再丢失可执行位, Git 不再显示模式变更.
- Spec Readiness 收集工作树中的 Agent 指令副本时, Git 清单仍列出但已在工作树中删除 (未暂存删除) 的文件被跳过, 而不是让整轮准备因读取失败而中断.
- Application Jira 的子模块 fetch 与上游证明的 fetch 使用足够长的超时 (建议 10 分钟), 不再沿用 Git 读取命令的 30 秒默认值; 其他 Git 命令的超时不变.


### M2

修复 Repository Workflow 与 Code Map 中已核实的四个缺陷, 使行为与现有规则一致:

- 仓库工作流的文件系统 Adapter 把符号链接分类为 `symbolic-link`, 与 Code Map Adapter 一致, 而不是抛出无路径的异常. 仓库中与 Code Map 无关的被跟踪符号链接 (如 `CLAUDE.md` 指向 `AGENTS.md`) 不再使 `workflow init` 和 `workflow verify` 失败; Code Map 根目录内且匹配纳入规则的符号链接仍按现有诊断 `code-map-candidate-symbolic-link` 阻断, 根目录遍历中的符号链接仍按现有诊断处理. 写入目标的符号链接仍关闭式失败 (规格中写入操作的规则不变).
- Code Map 覆盖检查只观察位于已配置根目录内的 Git 可见路径; 没有配置根目录时不逐个观察路径. 纳入与排除 glob 每次检查只编译一次.
- 仓库工作流的交互提问复用一个带缓冲的行读取器 (与安装器提问相同的做法), 管道一次送入的多行应答不再在两次提问之间丢失.
- 把同时含 `@AGENTS.md` 导入行与其他内容的 `CLAUDE.md` 迁移进 `AGENTS.md` 时, 不把该导入行复制进 `AGENTS.md`, 避免自引用.


### M3

删除全仓没有生产调用方的代码, 不改变任何行为:

- 锁文件模块中只服务于已不使用的托管内容移除规划的一族函数, 以及托管目标核对中只为它保留的 "未提供 Repository 状态" 分支 (仓库工作流的全部调用都提供该状态).
- 仓库工作流的依赖注入工厂 (全仓零调用).
- Workflow Distribution 布局校验中未使用的两个参数.
- 安装流程中随即被覆盖的一次配置字节赋值 (先确认中间的迁移步骤抛错时不依赖该值).
- 随之只测试被删代码的测试案例一并删除.

保留: 旧锁文件迁移注册表 (只注册一项, 但是否保留 v1 迁移是另一项决定), 以及开发规范要求的公共 Text Policy 验证 Interface validateText. 后者虽无生产调用方, 删除会改变公共 Interface, 按用户约束跳过.


### M4

Document Terms 按 `.arwignore` 文本自行判定纳入范围 (它也要在候选树上运行, 不能改用工作树的 `git check-ignore`). 当前判定在父目录已被排除时仍允许 `!` 规则重新纳入其下文件, 而 Git 及 ARW 其他使用 `.arwignore` 的命令 (Text Policy, Code Map, Commit Audit, Repository 状态观察) 规定父目录被排除时其下文件不能重新纳入. 本 issue 让 Document Terms 的判定在这一点上与 Git 一致: 某路径的任一祖先目录按目录语义被排除时, 该路径被排除, 不再检查针对该文件的 `!` 规则.

不改变 Document Repository Interface, 也不改变 Document Terms 的同步判定方式.


### M5

行为保持重构, 不改变任何结果, 诊断或持久记录:

- Reviewer 运行层中 "恢复记录不得位于可写目录内" 的判定在启动, 后续回合和报告绑定核对三处各写一遍, 合为一处.
- 恢复记录与受管运行的绑定比较有两份实现, 合为一份.
- 冷启动检查先遍历校验目录内全部记录再逐个重读, 改为只读一遍.
- Commit Audit 中只含两个提交审核角色的本地常量与 ARW 公共模块导出的同名常量含义不同, 改为能表明 "提交审核角色" 的名称, 并消除同一角色字面量的重复.


### M6

修复开发者工具与安装入口中已核实的小缺陷:

- Reviewer 能力测试场景构建失败时删除已创建的场景目录; 场景仓库提交时禁用提交签名与 hooks, 用户全局开启 `commit.gpgsign` 时构建不再失败或等待输入.
- 能力测试决定存储改用已有的原子 JSON 写入; `repair` 写变更记录前检查目标是否已存在, 不覆盖旧记录.
- 能力测试评分中重复实现的 SHA-256 摘要改用公共实现.
- 能力测试入口校验 `--limit` 是正整数, 无效时给出用法错误.
- 引导脚本用当前 Node 可执行文件 (而不是 PATH 中的 `node`) 启动安装, 下载设置超时.
- 安装契约中的 PowerShell 调用设置宽松超时 (建议 60 秒), 卡住时明确失败而不是无限等待.
- Windows 发布检查脚本找不到 Git 时明确失败, 而不是把仓库根当成当前目录.


### Shared prompt

将 lib/repository-workflow/workflow.mjs 与安装器的默认交互提问统一使用共享的带缓冲行读取器. 管道一次输入的多行回答跨问题保留, 结束后关闭读取器.

### Validation and edges

运行相关区域的确定性测试与完整 Source Checkout 验证: pnpm typecheck, pnpm test, 三个 node scripts/ 检查, 受影响 JavaScript 语法检查, node arw.mjs text check, node arw.mjs terms check --include .scratch/0084-confirmed-code-backlog/, git diff --check. 安装相关的 Windows 证据采用 Linux 上实际运行的 PowerShell 超时和缺少 Git 确定性平台分支测试, 经 Claude 明确接受; 实机检查留待下次发布验证的 win11 guest. 边界包括显式文件模式, 已删除的规则文件, 根目录外符号链接, 根目录内符号链接, 管道 EOF, 否定忽略规则, 已存在的修复记录, 无效 --limit, 下载和 PowerShell 超时及缺少 Git.

## Acceptance criteria

- M1:
  - [x] 替换模式写入 0755 的已有文件后, 文件仍为 0755; 调用方显式给出文件模式时仍以调用方为准.
  - [x] 一个被 Git 跟踪, 已在工作树删除但未暂存的 Agent 指令文件不使 Spec Readiness 准备失败, 规则副本中不含该文件, 其他规则文件照常复制.
  - [x] 子模块 fetch 与上游 fetch 使用新的较长超时, 确定性测试通过注入的 Git 运行器观察到该超时值; 其余 Git 调用仍为默认值.
  - [x] 按 `validation` Skill 完成受影响区域的验证.
- M2:
  - [x] 含被跟踪符号链接 `CLAUDE.md -> AGENTS.md` 且未配置 Code Map 的临时仓库中, `workflow init` 与 `workflow verify` 的结果与没有该链接时相同.
  - [x] Code Map 根目录内匹配纳入规则的符号链接仍产生 `code-map-candidate-symbolic-link`, 不抛异常.
  - [x] 未配置根目录时, 覆盖检查不对 Git 可见路径做逐个文件系统观察; 配置根目录时只观察根目录内路径, 诊断结果与改动前一致.
  - [x] 管道一次送入多行应答时, 交互式 `workflow init` 依次取得每个应答.
  - [x] `CLAUDE.md` 为 `@AGENTS.md` 加其他内容时, 迁移后的 `AGENTS.md` 不含 `@AGENTS.md` 行, 其他内容完整保留.
  - [x] 按 `validation` Skill 完成受影响区域的验证.
- M3:
  - [x] 上述代码与只覆盖它们的测试已删除, 全仓不再有对它们的引用.
  - [x] 托管目标核对在提供 Repository 状态时的结果不变.
  - [x] 按 `validation` Skill 运行完整测试与 Source Checkout 检查, 全部通过.
- M4:
  - [x] `.arwignore` 为 `docs/` 与 `!docs/keep.md` 时, Document Terms 把 `docs/keep.md` 与 `docs/other.md` 都视为排除, 与 `git check-ignore --no-index` 的结果一致.
  - [x] 父目录未被排除时 `!` 重新纳入照常生效 (例如 `*.md` 与 `!keep.md`).
  - [x] 工作树与候选树两种来源结果一致.
  - [x] 按 `validation` Skill 完成受影响区域的验证.
- M5:
  - [x] 上述重复已合并, 现有 Reviewer 运行层与 Commit Audit 测试不改断言即全部通过.
  - [x] 按 `validation` Skill 完成受影响区域的验证.
- M6:
  - [x] 场景构建在提交步骤失败时不留下场景目录; 全局 `commit.gpgsign=true` 时场景仍能构建.
  - [x] 决定存储写入中断不留下半截文件; `repair` 遇到已存在的变更记录时不覆盖.
  - [x] `--limit` 为 0, 负数或非数字时返回用法错误.
  - [x] 引导脚本使用当前 Node 可执行文件; 下载超时时明确失败.
  - [x] PowerShell 调用超时时安装明确失败并给出原因.
  - [x] 发布检查脚本在缺少 Git 时明确失败.
  - [x] 按 `validation` Skill 完成受影响区域的验证; 在 Linux 上运行 installation-contract.test.mjs 的 PowerShell 超时和缺少 Git 确定性平台分支测试, 作为 Claude 接受的本 issue Windows 证据.
- [x] 工作流和安装器的默认提问共享缓冲实现, 管道多行输入不丢失, EOF 明确失败.
- [x] 完整 Source Checkout 验证通过, 记录估计与实际的代码, 测试, issue 和文档改动行数.

## Blocked by

- None - can start immediately

## Validation

pnpm typecheck, pnpm test, node scripts/check-workflow-distribution.mjs, node scripts/project-claude-skills.mjs --check, node scripts/generate-install-arw.mjs --check 全部通过. 完整套件 901 个测试全部通过, 耗时 6656 毫秒. 所有受影响的 .mjs 文件通过 node --check. git diff --check 和 git diff --cached --check 通过. node arw.mjs text check 与 node arw.mjs terms check --include .scratch/0084-confirmed-code-backlog/ 通过. issue 的普通自然语言为中文, language inspect 为 Chinese 82.7%, English 17.3%.

M1: tests/common/filesystem.test.mjs 验证 0755 保留与显式 0640; tests/spec-readiness/spec-readiness.test.mjs 验证未暂存删除的指令文件; tests/application-jira/ 的两个 Git Adapter 测试验证 fetch 为 600000 毫秒而其他命令保持默认值.

M2: tests/repository-workflow/workflow.test.mjs 验证根目录外链接不阻断, 链接写入被拒绝与自导入行迁移; code-map.test.mjs 验证空根目录与限定根目录观察; 原有 Code Map 链接诊断断言继续通过. cli.test.mjs 通过真实 CLI 管道分别验证 Codex 和 Claude Code 多行回答. 安装和卸载原有管道 EOF 测试继续通过.

M3 和 M5: 已删除不可达分支及只服务这些分支的测试, 保留旧锁迁移. 全套 Reviewer Runtime 与 Commit Audit 原有断言通过. 安装器在配置迁移失败前不读取被删除的冗余赋值.

M4: tests/arw-common/text-policy.test.mjs 验证祖先目录排除不能由文件否定规则撤销, 普通文件否定规则仍生效; tests/document-terms/document-terms.test.mjs 验证工作树和候选树来源一致.

M6: tests/reviewer-capability-setup.test.mjs 验证全局签名配置不会影响场景建立, 提交失败删除目录, 无效 --limit 返回用法错误; reviewer-capability.test.mjs 注入原子替换失败并证明旧存储字节完整; format-penalty.test.mjs 证明已有变更记录不被覆盖. bootstrap.test.mjs 验证当前 Node 入口与 60000 毫秒下载超时. installation-contract.test.mjs 验证 PowerShell 调用超时在写入前明确失败, 缺少 Git 的 Windows 分支在安装前失败. 这些是 Linux 上的确定性平台分支验证, 不是实际 Windows 执行证据. Claude 明确接受这些实际运行的确定性测试作为本 issue 的 Windows 证据, 实机验证留待下次发布验证的 win11 guest.

单独测量全部改动测试文件: 224 个测试通过. 新增 PowerShell 超时和缺少 Git 案例分别为 3.82 和 49.08 毫秒, 新增已删除规则文件案例为 47.44 毫秒. 管道双平台真实 CLI 为 1623.65 毫秒, 场景签名及失败清理为 284.18 毫秒, 无效参数真实 CLI 为 355.29 毫秒; 这些测试依赖真实子进程, 按 Source Checkout Baseline 例外保留耗时, 不为降耗增加生产接缝.

改动行数按新增与删除合计: 预计代码 450, 测试 450, issue 和记录 100 行, 合计约 1000; 当前实际代码 344, 测试 343, issue 和记录 169 行, 合计 856. 代码净减 20 行, 比净减约 40 行的估计少减 20 行; 记录比估计多 69 行, 用于逐项验收和如实保留平台验证边界, 总体仍低于约 1000 行预算.

## Comments

Claude 明确授权按模块规划一个 effort 的两个 issue, 本 issue 是 Issue A; 计划 issue:0085:01 在本 issue 提交后执行. Claude 随后确认分为两个单 issue effort, 分别使用就绪例外. 2026-11-04 后续确认采用 triage 明确授权的缺陷修复范围.

M1 原草稿称四个缺陷, 本 issue 按授权排除 lib/background-agent/** 项后实际交付三个. 安装器原本已复用读取器, 本次只把其缓冲实现移到公共模块并由工作流共用. 新公共文件同步登记 release-manifest.json, 并更新隔离卸载测试的载荷.

- 台账: Windows 实机验证转入后续 issue; 下次发布验证的 win11 guest 检查覆盖

就绪例外已针对 Claude 接受的验证文字重新 generate, promote, verify 并通过. Commit Audit 第 1 轮准备输出: `code: -41 lines (files: 25)`, `documents: 0 characters (files: 0)`, `tests: +207 lines (files: 16)`. 后者是 Engine 净增口径, 与上文新增及删除合计口径不同.

第 1 轮 Commit Audit 的两项要求问题与一项 Code Standards 问题已独立核实: 开发规范要求 Text Policy 验证 Interface, 已恢复 validateText 并从删除范围移除; 补记实际通过的空白检查; 提交审核角色改用具名常量, 保留角色与报告路径的明确对应. 回归抽查确认符号链接写入仍拒绝, 普通忽略规则否定仍生效.

净减未达估计的原因: 保留规范明确要求的公共 validateText 入口 19 行, 按审核意见增加两个具名角色常量; 不以删除公共合同或无关代码抵扣. 当前代码仍为净减, 合计改动仍低于约 1000 行. 第 2 轮修复后完整套件再次 901 个测试全部通过.

第 2 轮 Requirements 和 Code Standards Reviewer 均正常返回 ready, 两份报告均为 No problems. 抽查具名角色与报告绑定保持准确, 恢复的 validateText 接受 LF 并拒绝 CRLF 与无效 UTF-8. 第 2 轮准备输出: `code: -20 lines (files: 24)`, `documents: 0 characters (files: 0)`, `tests: +207 lines (files: 16)`.

并入主仓库: 本 issue 并入 main 时 effort 由 0083 改为 0084, 计划中的 issue:0084:01 改为 issue:0085:01, 代码差异不变. 因受审版本的 HEAD 与暂存树已变, 重新运行了 Commit Audit.

第 1 轮 (并入后): Requirements 与 Code Standards Reviewer 均返回 ready. 一项要求问题经核实为行为缺陷并已修复: Node 的 execFile 超时错误只携带命令文本, 不含超时原因, 现由 `runPowerShell` 统一转换为 `PowerShell did not finish within 60 seconds.`, 测试改用与 Node 同形的错误 (`killed: true`, `signal: 'SIGTERM'`). 其余问题均非行为缺陷, 按台账记录:

- 台账: lib/spec-readiness/spec-readiness.mjs:438-446 与 docs/specs/agent-repository-workflow/spec.md:409 记录不修 M1 授权明确要求跳过未暂存删除的指令文件, 本 issue 禁止修改长期规范, 偏差记录于此, 留待后续规范变更补充该情形
- 台账: lib/arw-common/text-policy.mjs:160-178 记录不修 M4 的祖先目录判定与 issue 开头所述 Git 及 ARW 其他命令的规定一致, `arw text check` 与 `arw text fix` 随之对齐是预期结果, tests/arw-common/text-policy.test.mjs 已覆盖
- 台账: lib/repository-workflow/workflow-lock.mjs:426 记录不修 JSDoc 与四处调用方残留的 `repositoryRoot` 不影响行为, 不是行为缺陷
- 台账: lib/reviewer-capability/format-penalty.mjs:5 记录不修 保留 `sha256` 再导出避免改动 operations.mjs 导入, 不影响行为
- 台账: lib/commit-audit/commit-audit.mjs:217 记录不修 报告目录字面量与角色常量取值相同, 不影响行为

第 2, 3 轮 (并入后): 超时修复后 Requirements Reviewer 返回 No problems; Code Standards Reviewer 指出新增注释使用全角句号, 改为 ASCII 句号后第 3 轮返回 No problems. 并入后最终准备输出: `code: -6 lines (files: 24)`, `documents: 0 characters (files: 0)`, `tests: +207 lines (files: 16)`; 与并入前第 2 轮相比代码多 14 行, 来自 `runPowerShell` 统一超时转换, 合计仍为净减.
