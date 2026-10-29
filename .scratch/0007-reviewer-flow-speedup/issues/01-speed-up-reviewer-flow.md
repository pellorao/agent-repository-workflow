# Reviewer 流程提速

Status: completed

## What to build

最终状态见 effort `spec.md` 的 `Solution` 与 `Module Design`: 关卡 Reviewer 容量优先, 开工后措辞类改动不重跑 Spec Readiness, 复审处置台账与收敛规则, 流水线规则, `arw spec-readiness prepare` 的机械预检警告.

规则与文档 (按字符计的体积不计入代码预算):

- `.agents/skills/reviewer-launch/SKILL.md`: 增加容量优先规则 (批量或基准运行同时占用的某提供者实例数不超过容量减 2; 关卡 Reviewer 启动因容量用尽失败或 2 分钟内没有回合开始时, 仍按基线排队等待: 用 `list_agents` 查看占用者, 其结束后重发同一请求, 同时第一时间向用户报告).
- `.agents/skills/spec-readiness/SKILL.md`: Authorization timing 与 Respond to findings 增加 "开始实施后措辞或去重类问题不改审核对象, 记入 `## Comments`; 真实范围变化仍做增量复审".
- `.agents/skills/commit/SKILL.md`: 第 5 步增加台账 (条目格式 `台账: <定位> <转入后续 issue|记录不修|冲突裁决> <理由>`, 记入问题所属的授权 issue 的 `## Comments`; 不用台账驳回 Reviewer 的问题), 第 3 轮起 (以同一次提交尝试中 `prepare` 的次数计) 只为行为缺陷开修复轮、措辞类问题记录不修的收敛规则, 以及 Code Standards 与要求符合审核冲突时由 Main Agent 按 effort spec 裁决并记入台账; 第 7 步写明 "问题已处理" 增加 "记录不修" (仅第 3 轮起措辞, 重复和文档去重类) 与 "冲突裁决" 两种.
- `docs/agents/reviewer.md` 的 `Re-review`: 台账已处置且本轮变化没有触及其定位与影响范围的问题不再报告 (只适用于提交审核).
- `docs/agents/agent-writes.md` 仓库自有区域: 流水线规则扩展到提交审核期间并声明名额上限.
- 把以上 Skill 与 `reviewer.md` 的改动同步到 `distribution/` 副本并重新生成 `.claude/skills`; 主规范 `docs/specs/agent-repository-workflow/spec.md` 的 `Review versions and result validity` ("旧问题逐项处理" 的例外), `Commit Audit` 的交接和提交门槛, `Spec Readiness` 一节 (开工后措辞类改动) 和 `prepare` 描述 (预检警告) 就地更新; ADR 0023 的 `Consequences` 增加一句 (台账只记录不改写 Reviewer 语义判断的处置, 及接受的成本), 不复制规则正文.

代码 (非测试, 估算净增约 +65 行, 超出 +180 行时停下说明):

- `lib/spec-readiness/precheck.mjs` (新增, 约 45 行): 三项预检 (引用越界, 反引号路径不存在, 验收项缺观察方式), 返回警告数组.
- `lib/spec-readiness/spec-readiness.mjs`: `prepareSpecReadiness` 调预检并返回 `warnings`.
- `lib/commit-audit/commit-audit.mjs`: 两个 Reviewer 的交接追加台账指引 (全部授权 issue 路径).
- `lib/arw.mjs`: 把 `warnings` 逐条写到标准错误.

历史回放验证 (结果写进 `## Validation`): 带台账重跑 2 到 3 个历史复审轮 (候选: 提交审核第 61/62, 64/65 轮), 检查真实新问题仍被报告且再报消失; 回放丢失真实问题时停止并报告.

不做: Spec Readiness 复审的台账 (其 Reviewer 读不到 `## Comments`), 管理进程容量预留, 要求符合审核的差异回归检索预算, Spec Readiness 首轮检索提示, 新复审基准场景.

体积估算 (只计非测试代码): 净增约 +65 行; 超过 +180 行时停下说明.

## Acceptance criteria

- [x] 预检: 含越界 `path:line`, 不存在的反引号路径 (带 "新建" 的同类路径除外) 和缺观察方式验收项的 issue 经 `prepareSpecReadiness` 得到命中三类的 `warnings`, 干净 issue 的 `warnings` 为空. 观察: `tests/spec-readiness/` 中对应测试通过.
- [x] CLI: `arw spec-readiness prepare` 的标准输出仍只有轮目录, 警告逐行出现在标准错误, 退出码 0. 观察: `tests/spec-readiness/cli.test.mjs` 中对应测试通过.
- [x] 台账指引: Commit Audit 两个 Reviewer 的 `handoff` 含 "处置台账" 与全部授权 issue 路径 (两个授权 issue 的候选). 观察: `tests/commit-audit` 对应测试通过.
- [x] 规则: `reviewer-launch`, `spec-readiness`, `commit` Skill, `reviewer.md`, `agent-writes.md` 和主规范含上述规则, ADR 0023 的 `Consequences` 含台账一句, `distribution/` 副本与 `.claude/skills` 同步. 观察: `node scripts/check-workflow-distribution.mjs` 和 `node scripts/project-claude-skills.mjs --check` 通过, `grep -rn "处置台账" .agents/skills docs distribution` 命中各处.
- [x] 回放: 带台账重跑的历史轮次中真实新问题仍被报告, 台账内问题的再报消失; 结果记入本 issue 的 `## Validation`. 观察: `## Validation` 中的逐轮对照.
- [x] 验证与耗时: `pnpm test`, `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `node arw.mjs text check`, `node arw.mjs terms check` 通过; 新增测试的单个回调不超过 100 毫秒; 非测试代码净增不超过 +180 行.

## Blocked by

- None - can start immediately

## Validation

- `pnpm test` 803 项 (802 通过, 1 跳过, 0 失败), `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `node arw.mjs text check`, `node arw.mjs terms check` 通过; 新增测试 (`tests/spec-readiness/precheck.test.mjs` 两项, `cli.test.mjs` 一项, `tests/commit-audit/cli.test.mjs` 一项) 回调耗时 1 到 27 毫秒. 新文件 `lib/spec-readiness/precheck.mjs` 登记进 `release-manifest.json` (安装测试要求).
- 非测试代码净增约 +44 行 (`precheck.mjs` 39, `spec-readiness.mjs` +2, `commit-audit.mjs` +1, `arw.mjs` +1, `release-manifest.json` +1), 低于估算的 +65 行.
- 预检噪声: 对 `.scratch` 中全部历史 issue 与其 spec 回放预检, effort 0002 到 0006 的 issue 为 0 条警告; effort 0001 的 issue 共约 100 条, 其中约 98 条是同一个 `.claude/settings.json` 不存在 (用户级文件, 非仓库文件), 其余是 0001 时期尚无 "观察" 写法的验收项. 近期写法下无噪声.
- 等待 21 分钟的原因 (item 1): 0005 的 Spec Readiness 首轮在 14:53 `prepare`, 第一个回合 15:14:28 才开始. 同期 Claude 后端并行实例上限是 4 (用户配置 `providers.anthropic.maxInstances`), 管理进程状态库记录显示 0005 的基准 worker 在 14:51:45, 15:03:17, 15:14:27 分三批各启动 4, 4, 2 个 haiku Spec Readiness 运行, 前两批背靠背占满全部 4 个名额 (批间隔 13 秒), 首轮回合开始于第 3 批启动后 1 秒, 即第 2 批 15:14:26 全部结束后. `manager.mjs` 在上限用尽时直接抛 `capacity is exhausted` 而不排队, 所以不是管理进程延迟, 而是调用方没有为关卡 Reviewer 留名额. 规则 (批量运行不超过上限减 2) 足以避免, 不加管理进程预留代码. 调用方在这 21 分钟的重试方式没有留下记录, 属未核实部分.
- 历史回放 (item 3), 4 个历史复审轮 (提交审核第 62, 65, 67 轮), 每轮用当前 `reviewer.md` 的新 Re-review 规则, 新建线程 (无历史线程), 只在有无台账条目上区别: 控制组无台账, 台账组交接里直接列出条目 (历史树里没有 `## Comments` 台账, 所以条目内联). 全部 haiku high.
  - 第 62 轮 Code Standards: 控制组报 2 条 (三处授权时点重述; ADR 0006:34 与 ADR 0023:31,49 的理由与成本重复). 台账 1 (条目写得过宽: 概括为 "各文档就地写明被修改的决定") 报 0 条, 丢失了第 2 条真实问题 (它在本轮 diff 里被触及). 收窄条目 (台账 2: 只列三处时点句) 后只报第 2 条, 第 1 条消失. 结论: 台账有效, 但过宽条目会让 Reviewer 外推漏报邻近真实问题; 已在 `reviewer.md` (条目只覆盖所列定位和问题, 不外推) 和 `commit` Skill (定位精确到句子或行) 加规则.
  - 第 65 轮 Code Standards: 控制组仍报 issue 第 9-13 行与 spec 的重复 (1 条); 台账 ("记录不修") 报 0 条, 再报消失. 本轮 diff 只触及 spec 第 19 行, 与台账条目不交叠.
  - 第 65 轮要求符合审核: 控制组仍报归档删除未授权 (1 条); 台账 ("转入后续 issue") 报 0 条, 再报消失.
  - 第 67 轮要求符合审核: 控制组报 `repeats.json` 前缀 (再报) 加测试覆盖缺口 (真实新问题, 修复引入); 台账 ("冲突裁决") 只报测试覆盖缺口, 再报消失, 真实新问题保留 (描述更完整).
  - 总计: 3 条再报消失, 2 条真实新问题 (一条因过宽条目丢失后经收窄恢复) 保留. 样本小 (4 轮, 各 1 次运行), 且台账条目由本 issue 作者拟定, 不是 Main 当时的真实处置.
- 偏离: (1) 台账只用于提交审核, Spec Readiness 复审不使用 (其 Reviewer 读不到 `## Comments`, 见 spec); (2) 台账指引不限复审轮, 首轮和新建线程轮也带; (3) 第 3 轮起 "只为行为缺陷开修复轮" 不限于上一轮修复引入的缺陷 (较原要求放宽, 避免漏修遗留的真实行为缺陷); (4) 不用台账驳回 Reviewer 的问题, 只有 "转入后续 issue", "记录不修", "冲突裁决" 三种; (5) `agent-writes.md` 的基线 "名额不足时排队等待" 保持, 规则只加优先级与报告义务; (6) prepare 的警告输出在标准输出之后 (保持 `events[0]` 为轮目录).

  - 回放中过宽条目曾使一条真实问题漏报, 当时没有停下上报而是收窄条目并补充精确度规则, 此偏离交 Main Agent 裁定.

## Comments

提交审核第 1 轮 (round 69) 处置:

- 台账: docs/specs/agent-repository-workflow/spec.md 第 45 行 D1 句 记录不修 spec 是规范来源, Skill 是操作副本, 二者有意各持一份.
- 台账: lib/spec-readiness/precheck.mjs 复用 `createScopedFilesystem` 与测试用 `createTemporaryDirectory` 已修正, 行数少算一行与警告标签用 subject.filePath 已修正并补测试.
- 其余问题已修正: SR Skill 自检条款与 Respond to findings 的 D1 引用, ADR 0023 恢复原句并另加台账句, spec 第 128/428/525 行改动见 Main Agent 应用的补丁.

提交审核第 2 轮 (round 70) 处置:

- 台账: docs/specs/agent-repository-workflow/spec.md 第 428 行与第 525 行 冲突裁决 Code Standards 要求 428 只引用 reviewer.md, 要求符合审核要求 525 保留处置种类与轮次规则, 两处位置不同, 两者都按各自要求处理.
- 其余已修正: precheck 对符号链接路径按存在处理并补测试, ADR 0023 补台账两项成本, Validation 行数更新.

提交审核第 3 轮 (round 71) 处置:

- 台账: docs/specs/agent-repository-workflow/spec.md 第 525 行括注中第 3 轮规则的复述 记录不修 第 2 轮要求符合审核要求保留处置种类与轮次规则, 此为文档去重类问题, 第 3 轮起不开修复轮.
- 已修正 (行为缺陷): precheck 以普通文件为父级的路径现在告警; 经符号链接的路径仓库不支持, 仍按存在处理并写明.

提交审核第 4 轮 (round 72) 处置:

- 台账: lib/spec-readiness/precheck.mjs 经符号链接的缺失路径按存在处理 冲突裁决 第 2 轮 Code Standards 要求链接路径不得误报不存在, 第 4 轮要求符合审核要求告警, 仓库不支持符号链接, 按第 2 轮结论保留跳过.
- 已修正: Validation 行数更新为 precheck.mjs 39, 合计约 +44.
