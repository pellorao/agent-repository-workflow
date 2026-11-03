# 已删规则复查的已同意恢复项 (小项合批)

Status: completed

## What to build

已删规则价值复查 (removedrules) 中用户 2026-11-04 同意恢复, 且不含设计决定的 9 个小项, 合为一个 issue 一次提交审核 (各项互不依赖, 每项只改文档或一处脚本输出). 各项:

### 能力场景中 Reviewer 可见的名称保持中性

在 `.agents/skills/reviewer-capability/SKILL.md` 的 Scenarios 节, 紧接 "新增缺陷要同时补答案键和候选中的确定位置; ..." 之后补一句: 新增或修改场景时, Reviewer 可见的名称, 注释和顺序不得暗示缺陷位置, 也不得暗示问题用例与干净用例的分类 (例如文件名或注释里写 `bug`, `missing check`).

目的: 夹具里 Reviewer 可见的文字若泄露答案, 分数虚高, 掩盖真实能力差异 (旧规则 `cap-scenarios` 有此约束, 迁移时丢失). 只约束今后新增或修改的场景, 不要求改动现有夹具.

### 能力结果表加耗时列

在 `.agents/skills/reviewer-capability/SKILL.md` Run 第 9 步 (活动 issue 中的结果表) 列出的每格内容里加入耗时: 每个模型 × 场景 (× 格式) 除 `score`, 召回, 误报和偷懒迹象外, 还写 Reviewer 运行的耗时 (第 3 步记录的 `measurement`).

目的: `AGENTS.md` 要求 "速度提升很大而评分略有降低时交用户决定", 但现行结果表没有耗时列, 做这一判断时缺数据 (旧规则 `cap-session-inspection` 要求评分旁并列耗时, 迁移时丢失).

### 用户新消息改变委派依据时通知 subagent

在 `docs/agents/subagent-allocation.md` 的 Delegation and reuse 节, 紧接 "与用户沟通的 Main Agent 可以转发少量用户沟通, ..." 一段之后补一句: 用户的新消息改变已委派工作的依据, 授权或顺序时, 与用户沟通的 Main Agent 及时通知受影响的 subagent. 同步 `distribution/baseline/docs/agents/subagent-allocation.md` 的相同受管区域.

目的: 用户中途改了需求, 后台 subagent 照旧做完, 浪费一轮甚至交付错误结果 (旧 `subagent-allocation.md` 有此要求, 迁移时丢失). 本规则随分发规则带给所有使用者, 运行时无开销.

### 汇报区分事实, 推断和未确认事项

在根 `AGENTS.md` 的 Output Text 节 (受管区域) 增加一条: 向用户汇报时区分有证据的事实, 推断和未确认事项, 不把推断说成事实. 同步 `distribution/baseline/AGENTS.md` 的相同受管区域.

目的: Agent 把推断说成事实, 用户据此决策 (旧 `user-communication.md` 有 "区分有证据的事实, 推断和未确认事项" 的要求, 迁移时丢失; 现行文档里进度和结果汇报没有约束). 本规则随分发规则带给所有使用者, 运行时无开销.

### 失败可归因于 Agent 沙箱时不改代码, 换环境重跑

在 `.agents/skills/validation/SKILL.md` 的 Reuse and parallel runs 节末尾补一句: 验证命令失败可归因于 Agent 的执行环境 (沙箱禁止子进程或本机回环网络, 报 EPERM 等) 时, 不改产品代码, 不删除或放宽测试, 在具备该能力的环境中原样重跑同一命令. 同步 `.claude/skills/validation/SKILL.md` 投影和 `distribution/skills/validation/SKILL.md` 分发副本. validation Skill 随分发规则安装到目标仓库, 所以这条对所有使用者生效.

目的: Agent 在受限沙箱里运行测试, 子进程或 loopback 报 EPERM, 去 "修" 测试或产品代码, 把环境问题变成代码缺陷 (旧 `source-checkout-release-validation-troubleshooting.md` 有此要求, 迁移时丢失, 现行文档没有).

### 公告交审核前先自查

在 `.agents/skills/release/references/publication.md` 的 "Publish the GitHub announcement" 节要点列表中增加一条持久的迁移提示规则: 全局配置的键 (如 Reviewer 角色键) 已停用, 改名或合并, 而此前的发布公告都没有说明时, 公告用一行写出哪些键现在被忽略, 以及其设置应迁到哪里 (对照代码范围和此前的公告判断). 提交审核第 1 轮指出写成发布后自删的一次性文字不合长期文档要求, 改为此条件规则; 目的是让 0.5.0 退役 `code-spec-reviewer` 和 `commit-audit-reviewer` (合并为 `requirements-reviewer`) 一事出现在下一份公告 (0.5.2) 里, 因为 0.5.0 与 0.5.1 的公告都没有提.

目的: 让维护者少挑一轮机械错误 (旧 `source-checkout-release-publication.md` 有 "交审核前先机械检查公告的比较端点, 章节, 链接, 排除内容", 迁移时丢失; 现在直接交审).

### 公告提示已退役的角色模型键被忽略

在 `.agents/skills/release/references/publication.md` 的 "Publish the GitHub announcement" 节要点列表中增加一条持久的迁移提示规则: 全局配置的键 (如 Reviewer 角色键) 已停用, 改名或合并, 而此前的发布公告都没有说明时, 公告用一行写出哪些键现在被忽略, 以及其设置应迁到哪里 (对照代码范围和此前的公告判断). 提交审核第 1 轮指出写成发布后自删的一次性文字不合长期文档要求, 改为此条件规则; 目的是让 0.5.0 退役 `code-spec-reviewer` 和 `commit-audit-reviewer` (合并为 `requirements-reviewer`) 一事出现在下一份公告 (0.5.2) 里, 因为 0.5.0 与 0.5.1 的公告都没有提.

目的: 用户给旧角色单独配置的模型会悄悄失效, 又没有任何报错. 该退役随 0.5.0 发出 (`lib/arw-common/reviewer-configuration.mjs` 的 `RETIRED_REVIEWER_ROLES`, 安装规范 `docs/specs/agent-repository-workflow-installation/spec.md` 已记录), 此前的公告没有提示.

### 发布 guest 检查要求 `arw --version` 标准错误为空

在 `scripts/release-guest-check.mjs` 中, `run` 的返回值增加单独的 `stderr` (去掉首尾空白), `checkResolved` 在核对 `arw --version` 输出含候选版本之后, 再加一步 `<prefix>arw --version 标准错误为空`, 要求该次调用的 `stderr` 为空, 否则按现有 `step` 规则输出 `FAIL` 并以退出码 1 结束.

目的: Windows 的 `arw.cmd` 或 Node.js 在标准错误输出警告而版本行正确时, 用户每条命令都会看到噪声, 现行检查只核对版本字符串, 发布照常通过 (旧 `cross-platform-vm-scenarios.md` 要求启动器观察 "stderr 为空", 迁移时丢失). 覆盖的每个解析场景 (cmd, PowerShell, 重装后, 卸载后重装后) 都经过 `checkResolved`, 所以各场景都得到检查.

### 修复发布 guest 检查对 Linux 进程创建时间格式的判定

`scripts/release-guest-check.mjs` 的步骤 `读取本进程创建时间` 只接受纯数字, 而 `94713da` 起 Linux 的进程创建时间是 `<内核 boot id>:<启动 ticks>` (Windows 仍是纯数字 ticks). 把该步骤的判定改为复用 `lib/background-agent/process-identity.mjs` 导出的 `creationValuePattern` (接受纯数字和 `<boot id>:<ticks>` 两种形式), 不在脚本里另写正则 (提交审核第 1 轮).

背景: 在宿主 Linux 上以隔离 `HOME` 运行 guest 检查时, 该步骤直接 `FAIL`, 后面的全部情形都不会运行, 所以按现状发布验证在每台 Linux VM 上都会失败. 该缺陷由 0079 的本地运行发现, 属于机械修复, 不涉及设计决定.

预算: 文档各项合计约 1200 字符 (含各副本); 代码 (`scripts/release-guest-check.mjs` 与 `lib/background-agent/process-identity.mjs`) 实测净增 +8 行 -5 行, 即净增 3 行.

## Acceptance criteria


能力场景中 Reviewer 可见的名称保持中性:

- [x] Scenarios 节含: 新增或修改场景时, Reviewer 可见的名称, 注释和顺序不暗示缺陷位置或问题与干净的分类.
- [x] `.claude/skills/reviewer-capability/SKILL.md` 投影与源一致.
能力结果表加耗时列:

- [x] 第 9 步的结果表内容含耗时 (来自 `measurement`).
- [x] `.claude/skills/reviewer-capability/SKILL.md` 投影与源一致.
用户新消息改变委派依据时通知 subagent:

- [x] `docs/agents/subagent-allocation.md` Delegation and reuse 节含上述一句.
- [x] `distribution/baseline/docs/agents/subagent-allocation.md` 的受管区域与源文件一致 (除源文件的 Repository-owned 区域外无差异).
- [x] `node scripts/check-workflow-distribution.mjs` 通过.
汇报区分事实, 推断和未确认事项:

- [x] `AGENTS.md` Output Text 节含上述一条.
- [x] `distribution/baseline/AGENTS.md` 的受管区域与源文件的受管区域一致.
- [x] `node scripts/check-workflow-distribution.mjs` 通过.
失败可归因于 Agent 沙箱时不改代码, 换环境重跑:

- [x] `.agents/skills/validation/SKILL.md` 含上述一句.
- [x] `.claude/skills/validation/SKILL.md` 与 `distribution/skills/validation/SKILL.md` 与源文件逐字节一致.
- [x] 分发副本自包含, `node scripts/check-workflow-distribution.mjs` 通过.
公告交审核前先自查:

- [x] `publication.md` 在交维护者审核之前含自查要求: 比较端点, 链接可达, 不含被撤销或替换的内容.
- [x] `.claude/skills/release/` 投影与源一致.
公告提示已退役的角色模型键被忽略:

- [x] `publication.md` 的公告要点含该条件性迁移提示规则 (键被停用, 改名或合并且此前公告没说明时, 一行写出被忽略的键和设置应迁到哪里), 不含自删文字.
- [x] `.claude/skills/release/` 投影与源一致.
发布 guest 检查要求 `arw --version` 标准错误为空:

- [x] `run` 返回的对象含 `stderr`; 现有调用方不受影响.
- [x] `checkResolved` 在版本核对后输出 `ok <prefix>arw --version 标准错误为空`, 标准错误非空时输出 `FAIL` 并退出 1.
- [x] 在宿主 Linux 上用隔离 `HOME` 运行 guest 检查到 fixture 步骤之前, 新步骤出现且为 `ok`.
- [x] `pnpm typecheck`, `node --check scripts/release-guest-check.mjs` 与 `pnpm test` 通过.
修复发布 guest 检查对 Linux 进程创建时间格式的判定:

- [x] 步骤 `读取本进程创建时间` 在 Linux 返回 `<boot id>:<ticks>` 时输出 `ok`, 在 Windows 返回纯数字时同样输出 `ok`.
- [x] 在宿主 Linux 上用隔离 `HOME` 运行 guest 检查, 该步骤为 `ok`, 后续步骤继续运行.
- [x] `pnpm typecheck`, `node --check scripts/release-guest-check.mjs` 与 `pnpm test` 通过.

验证: `node scripts/project-claude-skills.mjs --check`, `node scripts/check-workflow-distribution.mjs`, `node arw.mjs text check`, `node arw.mjs terms check --include .scratch/0082-removedrules-restores/`, 对改动路径 `git diff --check`.

## Blocked by

- None - can start immediately

## Validation

- 提交审核第 1 轮修复后在同一工作树上重跑 (2026-11-04): `pnpm typecheck` 通过, `pnpm test` 890 个测试全部通过, `node --check scripts/release-guest-check.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/check-workflow-distribution.mjs`, `node arw.mjs text check`, `node arw.mjs terms check --include .scratch/0082-removedrules-restores/` 通过, `git diff --check` 与 `git diff --cached --check` 无输出.
- guest 检查: 宿主 Linux 上隔离 `HOME` (`HOME` 与 `USERPROFILE` 指向临时目录, `PATH` 去掉真实安装目录, `ARW_NESTED_GUEST_CHECK=1`, 占位 fixture 和 `pack-release` 产物) 运行到占位 fixture 解压步骤: `读取本进程创建时间` 输出 `ok: <boot id>:<ticks>`, `arw --version 标准错误为空` 为 `ok`, 前后的安装, 解析, init, verify, remove 步骤依次 `ok`; 只在占位 fixture 不是 gzip 处 `FAIL 解压 fixture`, 该步及之后需要维护者的真实 fixture, 未运行. Windows 的纯数字形式由同一正则的第一支接受, 未在 Windows 上运行.
- 各项实测 (文档项为合批时的字符数):
- 能力场景中 Reviewer 可见的名称保持中性: 实测净增 (各副本字符数相加) 192 字符, 0 行代码, 0 行测试.
- 能力结果表加耗时列: 实测净增 (各副本字符数相加) 58 字符, 0 行代码, 0 行测试.
- 用户新消息改变委派依据时通知 subagent: 实测净增 (各副本字符数相加) 126 字符, 0 行代码, 0 行测试.
- 汇报区分事实, 推断和未确认事项: 实测净增 (各副本字符数相加) 76 字符, 0 行代码, 0 行测试.
- 失败可归因于 Agent 沙箱时不改代码, 换环境重跑: 实测净增 (各副本字符数相加) 279 字符, 0 行代码, 0 行测试.
- 公告交审核前先自查 (第 1 轮后只引用上文两条规则, 不重述): 实测净增 (各副本字符数相加) 180 字符, 0 行代码, 0 行测试.
- 公告提示已退役的角色模型键被忽略: 实测净增 (各副本字符数相加) 318 字符, 0 行代码, 0 行测试.
- 发布 guest 检查两项合计 (`git diff --cached --numstat HEAD`): `scripts/release-guest-check.mjs` +7 行 -4 行, `lib/background-agent/process-identity.mjs` +1 行 -1 行 (仅加 `export`), 测试 0 行; 两项改动在同一文件内交叠, 不再拆分记录.
- 第 1 轮后公告两项的字符数已变, 以 `git diff --cached` 为准.

## Comments

- 来源: 已删规则价值复查 (removedrules) 的已同意恢复项, 用户 2026-11-04 同意.
- 原拆为 9 个单 issue effort (0071-0075, 0077-0080, 未提交); 按用户 2026-11-01 的 issue 大小要求 (小改动按改动行数合并, 省每次提交审核的固定开销) 合为本 issue. 0069 与 0070 (A/B 次数, A/B 同版比较) 与能力测试规则相关且 0069 含设计决定, 并入 effort 0081 的 spec.
- 就绪记录为例外 (`not-applicable`): 本 issue 不含设计决定, 用户已于 2026-11-02 对这类 issue 作出常设确认, `confirmedAt` 写该常设确认作出的时间 2026-11-01T17:01:05Z (与已提交的 0062, 0063, 0066 相同).
- 交付核对: 0.5.2 公告是否写出两个旧角色键已被忽略、设置迁到 `requirements-reviewer`, 由该次发布按本规则核对 (本次提交只交付规则).
- 台账: .scratch/0082-removedrules-restores/issues/01-removedrules-restores.md:47 冲突裁决 总层 "ARW 自主工作方式" 规定 Agent 指令修改不逐处预先确认, 由用户按实施 issue 复核整体 diff, Reviewer 按此审查; 改写为长期条件规则是为落实已同意条目的目的 (让旧角色键被忽略一事出现在公告里), 已在状态页告知用户.
- 台账: .agents/skills/release/references/publication.md:18 冲突裁决 第 2 轮 requirements-reviewer 指出原触发条件 (上一个 tag 以来) 让 0.5.0 的退役永远进不了公告, 改为 "此前公告未说明" 后第 3 轮 requirements-reviewer 无问题; 删掉该条件会重新造成第 2 轮的缺陷, 判断所需的历史公告就是 GitHub Release 正文, 发布 Agent 本就要读上一个 tag 的公告.
- 台账: .agents/skills/release/references/publication.md:21 冲突裁决 "指向存在的对象" 是第 2 轮 requirements-reviewer 按验收 "链接可达" 要求补的; `:19` 的 "仍然有效" 指不链接已撤销或替换的提交, 与链接可达是不同的检查, 不是复述.
