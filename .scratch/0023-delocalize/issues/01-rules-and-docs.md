# 规则与文档去除本机专属内容

Status: ready-for-agent

## What to build

本 issue 只改 Agent 规则与文档 Markdown, 按 `commit` Skill 的非实施工作流提交, 不安排 Spec Readiness. 目标: ARW 默认回到 Baseline (重要决定交用户, 提交只在用户请求后, 规则修改逐处确认), 使用者自己的自主工作方式改由仓库之外的上层指令文件承载, 并让 ARW 规则承认这类文件; 同时删除规则和长期规范中只对某台机器成立的内容.

1. 根 `AGENTS.md` 的 Repository-owned 区域: 删除整个 `# Autonomous Working Mode` 节 (从该标题到 `# Source Checkout Validation` 之前).
2. 根 `AGENTS.md` 的 `# Source Checkout Validation` 第二项: "交用户决定 (列入状态页 `decide`)." 改为 "交用户决定.". 能力测试门槛本身不变.
3. 根 `AGENTS.md` 受管理区域 `## Rule Conflicts` 的第一句, 以及 `distribution/baseline/AGENTS.md` 中的同一句, 改为: "用户级规则 (如 `~/.codex/AGENTS.md`, `~/.claude/CLAUDE.md`) 以及平台从本仓库之外的上层目录自动加载的指令文件 (如工作区根目录的 `AGENTS.md` 或 `CLAUDE.md`) 与 ARW 规则冲突时, 以它们为准." 该节其余文字不变. 理由: 原句只承认用户级文件, 而多个仓库共用的工作区级指令同样由使用者编写并由平台加载, 应能放宽 ARW 的 Baseline (例如使用者授权的自动提交, 规则修改改为整体复核, 重要决定排队而不阻塞). Codex 只加载用户级文件和 Git 根目录以内的 `AGENTS.md`, 该句对 Codex 不改变实际行为.
4. `docs/agents/agent-writes.md` 的 Repository-owned 区域: 删除引用 `Autonomous Working Mode` 的整段, 区域内容改为 `None.`, 与其他没有仓库规则的文档一致.
5. `docs/agents/subagent-allocation.md` 的 Repository-owned 区域: 删除最后一段 (引用 `Autonomous Working Mode` 的 "分析重要决策的独立 Agent 不降级" 要求). 其余映射表和 Fast 模式例外不变.
6. `docs/agents/writing.md` 受管理区域: 在 "长期文档必须独立表达当前有效的规则..." 段之后新增一段, 并同步到 `distribution/baseline/docs/agents/writing.md`: "已跟踪的仓库文本, 包括 `.scratch` 下的 ARW Artifact 和工作记录, 不记录只在某台机器上成立的内容, 如含用户名或主机名的绝对路径和本机服务地址; 改用仓库相对路径, 平台通用写法 (如 `~/.codex`, `CODEX_HOME`) 或占位符. 逐字引用的命令输出或日志含有这类内容时, 先替换为占位符." 理由: `.scratch` 和其他仓库文本随 Git 共享, 本机路径对其他使用者没有意义, 还会暴露用户名. 已有的 `.scratch` 历史记录不按此改写.
7. `docs/specs/agent-repository-workflow-installation/spec.md` 的 Shared model catalog 节: Strata 配置示例中 `installationDirectory` 的值 (含用户名的 Windows 盘符路径) 改为 `"/path/to/strata"`; 句子 "Strata 的安装目录是 Windows 服务从 WSL 访问时的实际目录, 不改变 ARW 对其他操作系统的支持范围." 改为 "`installationDirectory` 填 ARW 运行环境中看到的安装目录路径 (例如 Strata 作为 Windows 程序安装而 ARW 运行在 WSL 中时, 填 WSL 中的挂载路径), 不改变 ARW 对其他操作系统的支持范围.". 这两处是示例与说明, 不改合同条款, 所以不触发非实施工作流中长期规范合同条款的 `requirements-reviewer` 例外. issue 03 随后会改写该节的 Strata 部分.

分发副本: 第 3, 6 项的两个 `distribution/` 副本可直接编辑, 或运行 `node scripts/sync-workflow-distribution.mjs` 后确认 `distribution/` 的 diff 只有这两段.

明确不改: `.scratch` 历史记录; Reviewer 能力测试套件及其 Skill (除第 2 项外没有本机专属措辞; 提及基准来源 `qwen_strata` 的文字是来源说明, 不是本机路径); 公开仓库归属 (GitHub 仓库地址与版权人); 发布 VM 参考文档中的占位符写法.

体积预算 (文档字符, 含两份分发副本): 删除约 1,620, 新增约 530, 净增约 -1,090; 上限 -900.

预期验证: `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `arw text check`, 对改动的源文档 (不含分发副本) 运行 `arw language inspect`, 提交前 `arw commit-audit verify --non-implementation`. 不涉及 Reviewer 规则, 不做 Reviewer 能力对比. 边界情况: 第 4 项删除后区域不得为空, 必须是 `None.`; 第 3, 6 项的源文与副本必须逐字一致.

## Acceptance criteria

- [ ] `git grep -n -e "Autonomous Working Mode" -e "状态页" -- AGENTS.md docs distribution .agents .claude` 没有输出.
- [ ] 根 `AGENTS.md` 与 `distribution/baseline/AGENTS.md` 的 `## Rule Conflicts` 第一句都是第 3 项的文字.
- [ ] `docs/agents/writing.md` 受管理区域与 `distribution/baseline/docs/agents/writing.md` 都含第 6 项的段落, 位置在 "长期文档必须独立表达..." 段之后.
- [ ] `docs/agents/agent-writes.md` 的 Repository-owned 区域内容恰为 `None.`; `docs/agents/subagent-allocation.md` 不再引用 `Autonomous Working Mode`.
- [ ] `git grep -n -I -e "/mnt/[a-z]/Users" -e "wsl.localhost" -e "/home/" -- docs` 没有输出, 安装规范示例使用 `"/path/to/strata"`.
- [ ] 预期验证中的命令全部成功, `arw commit-audit verify --non-implementation` 错误列表为空.

## Blocked by

- None - can start immediately

## Comments

- 规划记录: 本 issue 删除了 ARW 中的自主工作方式. 提交本 issue 前, 与用户沟通的 Main Agent 先把经用户确认的自主工作方式写入使用者的上层指令文件 (仓库之外, 不属于本 issue 的交付), 避免出现只有 Baseline 的空档.
