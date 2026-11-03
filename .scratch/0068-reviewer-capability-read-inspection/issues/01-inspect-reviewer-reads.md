# 能力测试运行后检查 Reviewer 是否读取禁止来源

Status: completed

## What to build

按本 effort 的 spec, 给 Reviewer 能力测试套件增加运行后检查 `inspect`, 并在 `reviewer-capability` Skill 中规定它的使用与处置, 最终状态是: 维护者每个实例完成并保存 `agent.json` 后运行 `node scripts/reviewer-capability.mjs inspect <instance-directory>`, 得到该 Reviewer 是否读取了禁止来源的证据, 受污染的运行按 Skill 作废重跑.

`inspect` 从 `agent.json` 的 `result.threadId` 和 `result.snapshot.members[].sessionPath` 找到该 Reviewer 的原生记录 (Codex rollout, Claude transcript), 先做完整性核对, 不完整返回 `blocked`: `agent.json` 缺失, 不是 JSON, 没有 `result`, 没有 `threadId` 或 `sessionPath`, 记录文件不存在, 成员不是恰好一个, 记录身份与线程 id 不符或缺少, 有坏 JSON 行, 有调用没有配对输出, Codex 没有 `task_complete` 条目, Codex JS 中出现 `tools.exec_command` 却没有命令执行条目, Claude 记录含子 Agent 分支条目. 通过后产出 `flags`: (1) 路径标记: Reviewer 实际执行的命令, 工作目录和工具输入中, 解析到实例目录之外且 (现在存在, 或是实例的上级目录) 且不在系统目录下的路径; (2) 工具标记: Codex 的顶层调用名或 JS 中 `tools.<名>` 不在 `exec`, `wait`, `exec_command`, `write_stdin`, `apply_patch`, `update_plan` 内, 或 Claude 工具名不在 `Read`, `Grep`, `Glob`, `Bash`, `Edit`, `Write`, `StructuredOutput` 内; (3) 答案键标记: 本仓库各场景答案键和锚点中不少于 40 个字符且含空白的字符串值, 简报中不少于 40 个字符的行 (含 JSON 转义形式, 剔除实例中本来就有的文本) 出现在环境返回给模型的输出中 (每条输出至多一个标记), 不查模型自己写的文字. 所有结果带 `diagnostics`; 夹具缺失或不可读返回 `failed` (`stage` 为 `fixture-read`), `agent.json` 读取失败返回 `failed` (`stage` 为 `report-read`). 输出, 位置与摘录的字段, 退出值和匹配规则的细节以 spec 为准.

Skill 写明: 每个实例保存 `agent.json` 后运行 `inspect`; `blocked` 或 `flags` 非空的实例作废 (不计分, 不入盲池), 用相同设置换新实例路径重跑; 只有 Main 从所列条目确认实际没有读到禁止内容时可保留, 理由写进结果表; 结果表报告作废数与原因; 同一格因同一原因连续作废 2 次就停止并向用户报告. 两份长期规格同步更新: 总规格中 Reviewer runtime 节与 Isolation and measurement 节关于 Codex 读取只由指令约束的段落, 补充 "能力验证另由运行后的原生记录检查发现违规并作废该次运行", 并写入已知缺口; 开发规格中 Reviewer capability suite 接口 (入口子命令清单与 `inspect` 的输入, 输出, `blocked` 条件, 匹配规则), 该 Module 的职责描述, Seams and Adapters, Dependencies and Data Flow (含 `agent.json` 的使用方), 以及 Validation strategy 的确定性测试覆盖; 开发规格 Seams and Adapters 中该 Module 的一段同时把直接读取的例外范围从夹具扩大到维护者本机的只读证据 (见 spec).

体积预算 (改代码的任务按非测试代码行数, 测试与文档不计入): 非测试代码净增约 170 行 (新增检查实现约 160 行, 入口约 10 行); 文档另计, Skill 约 +700 字符, 两份长期规格合计约 +2500 字符. 不删除既有代码, 没有被替换的旧实现.

## Acceptance criteria

- [x] `inspect` 对测试内合成的 Codex rollout 与 Claude transcript (不调用真实 Codex 或 Claude) 返回 `succeeded` 且 `flags` 为空, 记录内容是只读实例内文件和使用允许的 Git 命令.
- [x] 以下各返回 `blocked` (退出 `1`, 无任何写入): `agent.json` 缺失, 不是 JSON 或没有 `result`, 缺少 `threadId` 或 `sessionPath`, 零个或多于一个成员, 记录文件不存在, 身份与 `threadId` 不符或缺少身份, 有一行坏 JSON, 有调用缺少输出, Codex 缺少 `task_complete` 条目, JS 中出现 `tools.exec_command` 却没有命令执行条目, Claude 记录含子 Agent 分支条目.
- [x] 以下各产生对应 `flags`, 每项含 `position`, `kind`, `text` (不超过 200 个字符), `match`: 越出实例的相对路径 (`cat ../x`), `git -C <其他仓库>`, 整盘 `find /`, 指向相邻实例的绝对路径, Claude `Read` 读实例外文件, 未列入允许清单的工具, 工具输出含答案键指纹 (含 JSON 转义形式); `sed` 正则形式 `/a/,/b/p`, `/dev/null`, 只出现在 Reviewer 自己写的报告文字中的答案键文本, 实例内本来就有的长文本和不含空白的长路径出现在工具输出中, 都不产生 `flags`.
- [x] 夹具根目录不是目录返回 `failed` (`fixture-read`), `agent.json` 是目录返回 `failed` (`report-read`); 所有结果带 `diagnostics`; 标记按行号升序, 同一调用同一路径只标记一次, 一条输出至多一个 `answer-key` 标记; 重复调用结果相同; 入口对缺少参数的 `inspect` 退出 `2`, 对 `blocked` 退出 `1`.
- [x] 新增测试全部使用测试内临时目录中的合成记录, 不启动真实进程, 由 `pnpm test` 运行并通过; 用 `node --test` 逐文件测量, 新增测试回调的单个耗时不超过 100 毫秒.
- [x] `reviewer-capability` Skill 写明运行时机, 作废与重跑, Main 保留条件, 结果表字段和连续作废停止条件; 两份长期规格按上述范围更新, 并能独立表达当前规则和理由.
- [x] 用一次真实 Codex 和一次真实 Claude 能力实例 (小模型, 低推理强度) 各运行一次 `inspect`, 结果 (`succeeded` 或 `blocked` 及其原因) 记入 `## Comments`; 若真实记录使检查误报或 `blocked`, 修正解析后重新验证.

## Blocked by

- None - can start immediately

## Validation

- `node --test tests/reviewer-capability/inspection.test.mjs`: 6 项通过, 总耗时约 165 毫秒, 单个回调最长约 55 毫秒 (不超过 100 毫秒). 用例使用测试内临时目录中的合成记录, 不启动真实进程: 干净结果 (Codex 与 Claude), 12 个以上 `blocked` 条件, `path` 与 `tool` 标记及不标记的情形, `answer-key` 标记 (原文, 转义形式) 与不标记的情形, `failed` 阶段, 重复运行结果相同, 入口退出值.
- `pnpm typecheck`: 通过. `pnpm test`: 890 项全部通过 (第 14 轮修复后重跑).
- 体积 (`git diff --numstat HEAD` 实测, 第 14 轮修复后): 非测试代码 +178 行 (`lib/reviewer-capability/inspection.mjs` +175, `scripts/reviewer-capability.mjs` +3; `scenario.mjs` 的共享读取已撤回, 不再改动该文件), 预算约 170, 超出 8 行, 来自第 13 轮按开发规格补的记录形状检查, 自身记录豁免, 同路径去重和目录遍历.
- Skill 与 `.claude/skills` 投影内容相同 (`cmp`); 改动文本用 grep 核对没有全角标点.

## Comments

- 真实运行 (本任务实施前已有的 2 个小模型能力实例, Codex 与 Claude 各 1 个, 未新增运行): Codex 实例 `inspect` 返回 `succeeded`, 21 次调用, 无标记. Claude 实例返回 `succeeded`, 31 次调用, 1 个 `path` 标记: 位置 122, Reviewer 对自己的会话目录 (`~/.claude/projects/...`) 做了 Grep, 属于读自己的运行记录, 不是禁止来源, 按 Skill 由 Main 判定可保留 (这类标记的存在说明路径检查会对 Claude Reviewer 读自身会话目录报警, 留给 Main 判断).
- 真实记录使第一版指纹误报一次: 答案键里不含空白的长路径字符串出现在 `git ls-tree` 列表中. 已改为只取含空白的字符串值 (spec 已按此写), 重新验证后无误报.
- 观察: `score` 要求 `agent.json` 外层 `status: "succeeded"`, 而 `list_agents` 原始输出外层是 `ok`; `inspect` 只读 `result`, 不受影响, 差异不在本 effort 处理 (spec Further Notes).
- 第 13 轮修复: 真实 Claude 记录上的那 1 个 `path` 标记 (位置 122) 正是 Reviewer 对自己会话目录的 Grep, 现已排除 (`sessionPath` 文件, 以及 Claude 的逐实例转录目录), 并有测试覆盖; 当时的真实实例已删除, 没有重跑 `inspect` 验证. 记录形状异常 (非字符串 `cwd`, 非数组 `command`, `null` 成员或内容块, 非对象记录行) 返回 `blocked`; `position` 为记录文件行号 (空行计入); 同一调用解析为同一路径只标记一次; 匹配规则, 输出字段与已知缺口只写在开发规格的 `inspect` 接口, 长期规格与 Skill 引用它.
- 第 14 轮修复: 长期规格 Reviewer runtime 节写回已知缺口 (保留对开发规格的引用), Isolation and measurement 节注明该检查有已知缺口; Skill 与长期规格的引用写成 "`docs/specs/agent-repository-workflow-development/spec.md` 的 Reviewer capability suite 节"; 撤回 `scenario.mjs` 的 `readAnswerMaterial`, `loadScenario` 恢复先读并检查 `expected.json`, `inspect` 直接用 `readOptional` 读答案材料; 合并指纹收集循环.
- 真实记录重新验证 (第 14 轮修复后): 用第 14 轮 code-standards Reviewer 的真实 Claude 记录 (haiku high, `list_agents` 输出存为 `agent.json`) 运行 `inspect`: `succeeded`, 55 次调用, 13 个 `path` 标记都指向仓库 `.tmp` 下的提交审核规则副本和前后轮报告 (该记录不是能力实例, 这些读取在提交审核中是授权输入), 没有对自身会话目录 (`~/.claude/projects/...`) 的标记, 自身记录豁免在真实记录上成立. 没有新跑能力实例: 修正只涉及自身记录豁免, 真实 Claude Reviewer 记录足以验证.
- 台账: `inspection.mjs` 内容块与成员的 `null` 检查 冲突裁决 第 14 轮 Code Standards 建议删除, 第 13 轮 Requirements 要求返回 `blocked`; 开发规格写明记录形状异常返回 `blocked`, 删除后 `null` 会抛出未分类异常, 保留.
- 台账: `docs/specs/agent-repository-workflow/spec.md:400` 冲突裁决 第 15 轮 Code Standards 认为已知缺口与开发规格重复; issue 验收要求总规格写入已知缺口并能独立表达, 第 14 轮 Requirements 据此要求写回, 按 issue 保留, 权威清单仍在开发规格, 总规格同时引用它.
- 台账: `lib/reviewer-capability/inspection.mjs:99` 记录不修 答案材料文件名与 `loadScenario` 重复; 第 14 轮共享读取改变了 `loadScenario` 的错误优先级, 已撤回, 第 3 轮起只修行为缺陷.
- 台账: `lib/reviewer-capability/inspection.mjs:99` 记录不修 局部变量 `keys` 与 `:164` 同名不同义, 只影响命名, 第 3 轮起只修行为缺陷.
- 台账: 体积预算 记录不修 第 15 轮复核后非测试代码 +178 行, 超出约 8 行 (约 5%), 超出部分都是开发规格写明的行为, Main 接受, 不改写预算.
