# 用真实难度场景测三个 Reviewer

Status: ready-for-agent

## What to build

ticket 10 定 txt 格式所用场景过小 (候选 72 到 82 行, 每 5 到 10 行一个缺陷), 且只测了 `requirements-reviewer`. 改用真实难度的场景重新测三个角色:

- 先把 qwen_strata benchmark v2 的 Reviewer 测试整套复制过来: 冻结的 ARW 源码 (`freeze_arw_source`), v1 `benchmarks/reviewer-suite-v1/arw-patches/` 的全部补丁 (场景逐版加难, 评分 `scoring-k`, harness 补丁 `strata-measurement-time-limit`, `reviewer-private-scratch`, `codex-0.163-synthetic-mount-targets` 等), v2 的 4 个场景补丁和 `scoring-r8.5`, 按 v2 计划声明的版本依次应用 (同 `arw_dimension prepare`), 并核对物化结果 (base/candidate/handoff, 答案键, 盲裁 brief) 与 benchmark 一致.
- 已商定的改动 (ARW 现行三个角色, txt 报告格式, Code Spec 与 Commit Audit 场景交给 `requirements-reviewer`, 用户选 A) 尚未在真实难度场景上验收. 先用原样复制的 qwen_strata 那套跑出基线, 再在复制结果上应用这些改动 (评分按 txt 格式适配) 跑同样的配置; 改动后的得分不低于基线 (在测量波动内) 才算验收通过 (用户 2026-10-26).
- 验收通过前, 需要本地 Strata 审查或 Reviewer 测量时都用 qwen_strata 原样的那套.
- 再从本仓库历史中取被独立审查抓到问题的真实提交 (如 `530cca6` 修复前) 做场景.
- 每个角色用 luna xhigh 和 haiku high 各跑 2 到 3 次, 记录召回, 误报, 偷懒迹象.
- Spec Readiness 另测 haiku xhigh, 在同一冒烟场景与 haiku high 比较收敛轮数 (15 冒烟中 haiku high 5 到 9 轮才收敛). 日常 Reviewer 不考虑 sonnet, 成本过高.
- 盲裁裁判模型 (用户 2026-10-27): 迁移验收 (改动后与基线对比) 沿用 haiku high, 与已有基线可比; 此后正式测量和 `$reviewer-capability` 的盲裁至少用 sonnet high, 不再用 haiku. 写进 `$reviewer-capability` Skill.
- 删除 commit Skill 中 "Gate 2 漏报记一行" 的规定: Reviewer 已固定为 haiku high, 不再需要调整模型的依据 (用户 2026-10-27).
- (2026-10-28 移到 issue 29: 套件在 ARW 内自成一体, 去掉补丁链, 盲裁工具改写为 Node) 用 qwen_strata benchmark v2 的整套 (v4.5 等版本的夹具, 原始答案键与判例覆盖, 盲裁 brief 与评分方法) 替换仓库内 `tests/fixtures/reviewer-capability/` 和 `$reviewer-capability` 的场景, 答案键与评分, 不再保留 ARW 旧版夹具和 ticket 10 简化的 `expected.md`; 基准内容不修改, ARW 角色与答案键口径不一致时改角色 (用户 2026-10-25 要求 "直接搬过来采用", 2026-10-27 确认).
- 本地 Strata 审查改为正规模式: 用户级配置把 Strata 设为 Reviewer 模型, 经 `arw background-agent` 的 Codex 后端启动, 与 benchmark v2 一致 (关闭搜索, 角色作为系统指令, 管理进程的压缩, 重复命令和时长处理). 审查范围按目录拆成几批, 可并行的模型并行跑.
- 用 benchmark v2 场景计一个 issue 的完整流程墙钟: 60 分钟以内为合格, 30 分钟以内为优, 达到优即停止流程优化 (用户 2026-10-26).
- 格式或模型需要调整时, 在本 ticket 中写明并修改.
- 第一批后用户决定 (2026-10-27): Spec Readiness 退步先由独立 Agent 逐条复核误报, 确属角色过严的收紧现行角色并去重后重测, 确属答案键口径过时的改答案键并写明理由; 今后正式测量用 benchmark 自带的盲裁 brief 盲裁, 不依赖报告语言.

## Spec Requirement

Governing requirements:

- `.scratch/0001-claude-code-migration/spec.md#review-workflow`

## Acceptance criteria

- [ ] 三个角色在真实难度场景上的召回和误报已测出, 记入 `## Comments`.
- [ ] 格式和默认模型的结论有数据支持, 必要的调整已完成.
- [ ] (移到 issue 29) 仓库内 Reviewer 能力验证的场景, 答案键和评分与 qwen_strata benchmark v2 逐文件比对一致 (差异清单为空), 旧版夹具与简化答案键已删除; 基准内容未修改.
- [ ] Spec Readiness 角色按用户决定修改: 第 11 行长期边界句与基准答案键口径一致 (不改基准); APPLICABILITY 的 Interface 包含已有字段的取值语义.
- [ ] "Gate 2 漏报记一行" 已从 `commit` Skill (含投影和分发副本), 本 effort spec (用户故事 13, Review workflow, Further Notes) 和长期规范中删除.
- [ ] 本仓库历史中被独立审查抓到问题的真实提交已做成场景并测量, 结果记入 `## Comments`.
- [ ] 本地 Strata 审查已按正规模式运行 (Codex 后端, 关闭搜索, 按目录拆批并行), 结果记入 `## Comments`.
- [ ] Spec Readiness 收敛优化后, benchmark v2 场景的完整流程墙钟 ≤30 分钟; 优化手段和测量记入 `## Comments`.

## Blocked by

- issue:0001:15

## Comments

### 2026-10-27 第一批测量 (worker, 未提交)

范围: 原样复制 benchmark v2 Reviewer 测试, 基线, 改动后条件, Spec Readiness haiku xhigh 对比. 本仓库历史场景, Strata 正规模式, 完整流程墙钟, "Gate 2 漏报记一行" 未做.

方法:

- 复制: 冻结 ARW 源码加 v1 补丁和 v2 场景补丁, 按 v2 计划版本应用. 4 个计划的物化结果 (base/candidate/handoff, 答案键, 盲裁 brief) 与 qwen_strata 逐字节一致. 工具和物化结果在 worktree 的 `.tmp/claude-code/<session>/0001_18/` (未跟踪, 约 4MB).
- 改动后条件: 场景不变, 改用 ARW 现行三个角色和 txt 格式, Code Spec 与 Commit Audit 交给 `requirements-reviewer`.
- 运行: 每个配置 2 次, 经源码 `node arw.mjs background-agent` 启动. haiku high (Claude 后端), luna xhigh (Codex 后端).
- 评分: 冻结评分器靠英文 referenceTerms 关联, 现行角色写中文报告, 改动后条件在冻结评分器下检出为 0, 无法公平比较. 两个条件统一改用自写的格式无关匹配器 (按答案键的定位行与关键词把每条发现分给最匹配的案例, 命中 clean 案例或无匹配记误报), 再由 worker 人工复核误报. 不是盲裁. 基线另用冻结评分器打分, 作参考.
- 偷懒迹象: 记为 incomplete 或明显过短的运行.

结果 (召回为 2 次检出之和/问题总数之和, 误报为 2 次之和, 耗时为每次平均分钟):

| 场景 | 模型 | 基线召回 | 基线误报 | 基线耗时 | 改动召回 | 改动误报 | 改动耗时 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Code Spec | haiku | 31/40 | 0 | 5.8 | 35/40 | 0 | 4.6 |
| Code Spec | luna | 31/40 | 1 | 10.4 | 33/40 | 1 | 8.9 |
| Code Standards | haiku | 38/52 | 2 | 5.3 | 41/52 | 3 | 3.5 |
| Code Standards | luna | 38/52 | 0 | 7.1 | 39/52 | 1 | 6.3 |
| Commit Audit | haiku | 80/80 | 0 | 7.1 | 78/80 | 2 | 5.8 |
| Commit Audit | luna | 2 次均 incomplete | - | - | 79/80 | 1 | 8.9 |
| Spec Readiness | haiku | 37/46 | 4 | 9.3 | 30/46 | 8 | 10.8 |
| Spec Readiness | luna | 33/46 | 3 | 16.3 | 33/46 | 13 | 23.8 |

单次波动: haiku SR 基线 18 与 19, 改动 16 与 14; luna SR 基线 20 与 13, 改动 15 与 18. Spec Readiness 耗时含 runtime 与 artifact 两个子场景.

冻结评分器 (基线 rep1, haiku): Code Spec 0.572, Code Standards 0.699, Commit Audit 0.889, SR runtime 0.979, SR artifact 0.540. luna: Code Spec 0.641, Code Standards 0.662.

结论:

- Code Spec, Code Standards, Commit Audit: 改动后不低于基线, 耗时更短, 验收通过. Commit Audit 两边都接近满分, 区分度低.
- Spec Readiness: 未通过. haiku 召回 37 降到 30, 误报 4 升到 8; luna 召回持平, 误报 3 升到 13. 复核误报: 主要是现行角色把 "不改变调用方行为的算法要求" 和 `#adr-evaluation` 章节判为不应进入长期规范, 另有同一问题重复报告. 这是现行 SR 规则与 v2 答案键的口径差异加重复, 不是格式错误. 需要决定是改现行 SR 角色, 还是认定答案键过时.
- luna 基线 Commit Audit 失败是原样套件本身的问题: 一次称 `docs/agents/commit-audit-reviewer/gate-2.md` 不存在 (实际在 `docs/agents/roles/commit-audit-reviewer/gate-2.md`, 旧角色文本的相对链接作为指令下发后失效), 一次称 `reviewer.md` 要求读 `commits.md` 而 handoff 禁止读. haiku 自行解决了路径. 改动后条件无此问题.
- 偷懒迹象: 除上述外, 只有 haiku 基线 rep2 三个运行因 Claude 后端在 dontAsk 模式下拒绝 Read/Bash 而在 1 分钟内 incomplete. 这是后端权限的偶发问题, 不是模型偷懒, 已换新实例重跑并计为 rep2.

Spec Readiness 收敛轮数 (15 冒烟 `claude-pre-readiness` 场景, 各 1 次, worker 自己按发现修 spec):

| 配置 | 轮数 | 各轮缺口数 | 总耗时 |
| --- | --- | --- | --- |
| haiku high | 3 | 10, 2, 0 | 7.3 分钟 |
| haiku xhigh | 5 | 2, 7, 1, 1, 0 | 17.6 分钟 |

xhigh 没有更快收敛, 第 2 轮重新提出整篇层面的问题, 耗时为 high 的 2.4 倍. 只有 1 个样本, 且两边的修法随发现不同, 结论只作参考; 维持 haiku high.

偏离: 未用盲裁, 改用规则匹配加人工复核; 修 spec 时没有按规则与独立 subagent 共同决定; luna SR 基线 rep1 的 artifact 子场景因供应商容量拒绝重发一次, 耗时偏长.

### 2026-10-27 第二批: Spec Readiness 复核, 盲裁, 完整流程墙钟 (worker)

Spec Readiness 复核: 独立 Agent (opus) 先不看 worker 结论, 逐条复核第一批 21 条误报和 29 条漏报, 再与 worker 合并意见. 结论:

- 现行角色与基线角色的检查文本几乎相同. 第一批 "退步" 大部分来自自写匹配器的偏差: 只认英文关键词 (基线 handoff 要求英文报告, 现行不要求), runtime 与 artifact 两个子场景合并计分, 贪心分配, 以及基线中的隐性误命中. 只纠正匹配器错误后, haiku 改动召回为 33/46 (基线 37), luna 为 38/46 (基线 33).
- 确属角色过严的有两处, 已在 worker 的 worktree 改 `docs/agents/roles/spec-readiness-reviewer.md` 及其分发副本 (未提交, 见下方 "提交阻断"):
  - INPUTS: 原文要求 "分别检查适用权威, 来源, 新鲜度边界和持续时间", 导致对设计可自选的内容报缺失事实. 改为只为选定要求或适用权威确实要求的事实报告缺失或未知.
  - REQUIREMENTS: 现行角色把所选治理 spec 中的理由, Module Design, ADR Evaluation, Testing Decisions 章节判为 "只提供辅助信息的 Input" 而报 `gap`. 补一句说明这些章节不是辅助信息.
- 没有找到纯重复报告, 未做去重改动.
- 答案键未改. 改用盲裁后, 答案键之外的真实缺陷判为 supported, 不扣分, 已不构成误报来源. 仍有争议的条目见下方待决定事项.

评分方法: 按 qwen_strata 多模型 v2 的盲裁流程复现. 冻结 r8.5 评分器 `score-completed` 列出关联和发现候选; qwen_strata 的 `blind_pool` 按 v2 登记表组池 (每池 12 个锚点, SR 9 个合成对照, 隐藏来源, 每池最多 210 项) 并生成冻结 brief; 由 `claude_headless` 以 benchmark 的裁决参数 (`--copy ADJ:adj --write adj`, 无启动和压缩提示, 工具 Read,Write,Edit,Glob,Grep,Bash) 运行; `blind_pool split` 检查锚点一致率 ≥90% 且合成对照全对; 多轮迭代直到无候选, 再用全部裁决计分. 现行 txt 报告先逐行转换为冻结角色的 JSONL 行 (发现原文不变, 证据取文中的 `path:lines`). 与 benchmark 的偏离: 裁决模型用 haiku high 而不是 Opus high (用户规定 Claude 侧只用 haiku); haiku 有时把 brief 固定的 adjudicator 标签写成自己的模型名, 驱动脚本统一改回该标签; 不写 qwen_strata 配额账本. 7 个池全部通过 (锚点 100%, 合成对照全对). 工具在 worktree 的 `.tmp/claude-code/<session>/0001_18/kit/` (`blind.py`, `sr_txt2jsonl.py`, `records.py`, `reports_of.py`, 未跟踪).

结果 (每个条件 2 次; 检出与失败 clean 为 2 次之和, 问题共 46; 分数为 2 次的平均, 分 runtime 与 artifact 两个子场景; 匹配器为第一批的自写匹配器, 只作延续参考):

| 模型 | 条件 | 盲裁检出 | 盲裁失败 clean | 盲裁分数 runtime | 盲裁分数 artifact | 匹配器召回 | 匹配器误报 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| haiku high | 基线 (原样角色) | 33/46 | 8 | 0.94 | 0.55 | 37/46 | 4 |
| haiku high | 第一批改动 | 25/46 | 26 | 0.87 | 0.23 | 30/46 | 8 |
| haiku high | 收紧后 | 33/46 | 6 | 0.90 | 0.48 | 28/46 | 9 |
| luna xhigh | 基线 (原样角色) | 31/46 | 16 | 0.63 | 0.53 | 33/46 | 3 |
| luna xhigh | 第一批改动 | 35/46 | 19 | 0.76 | 0.58 | 33/46 | 13 |
| luna xhigh | 收紧后 | 33/46 | 5 | 0.79 | 0.62 | 32/46 | 7 |

单次: haiku 基线 16, 17 (失败 clean 6, 2), 第一批 15, 10 (3, 23), 收紧后 14, 19 (4, 2); luna 基线 18, 13 (15, 1), 第一批 18, 17 (4, 15), 收紧后 16, 17 (3, 2). 收紧后单次耗时 haiku 12.2 与 9.8 分钟, luna 12.2 与 10.1 分钟 (4 个并发).

结论:

- 盲裁下收紧后的角色: haiku 检出与基线持平, 失败 clean 更少; artifact 子场景平均分 0.48 低于基线 0.55, 但单次分数 (0.30, 0.67 对 0.48, 0.62) 在波动范围内重叠. luna 检出, 失败 clean 和两个子场景分数都优于基线. 判定 Spec Readiness 改动后不低于基线 (在测量波动内), 验收通过.
- 第一批改动条件中 haiku 第 2 次失败 clean 23 是离群值, 主要是大量把设计可自选内容报为缺失事实, 正是 INPUTS 收紧的对象.
- 自写匹配器与盲裁的差距说明它不能作为正式分数; 今后以盲裁为准.
- Code Spec, Code Standards, Commit Audit 未做盲裁重评: 第一批改动条件把这三个场景交给 `requirements-reviewer`, 其 txt 报告没有冻结角色的逐行格式, 转换需要另写适配; 第一批结论已是 "不低于基线", 投入产出比低, 留作后续.

"Gate 2 漏报记一行": ~~ticket 08 已落实, 无需改动~~. 用户决定 (2026-10-27) 删除该规则, 见 What to build.

工具拒绝: 收紧后 haiku 4 个会话共 116 次工具调用, 只有 1 次拒绝: Bash 中的 `python3 -c` 不在只读允许范围, 拒绝消息说明了原因和可用工具, Reviewer 改用 Read 继续完成. 第一批那种 Read/Bash 的偶发拒绝未再出现.

完整流程墙钟: 取 benchmark v2 Commit Audit v3.1 场景的 base (spec, `docs/dispatch`, issue 01 与 02, 含预置的 spec 缺陷), 以本 worktree 的 ARW 执行 `arw workflow init`, Main Agent 为 `claude -p` sonnet high (真实 HOME, 只读项目级设置), 任务为实现 issue 01 并提交. Reviewer 由 Claude 后端以 haiku high 运行. 用户不在线, 只在 Main 停下时给一次现实回复.

| 段 | Agent 墙钟 | 内容 |
| --- | --- | --- |
| 第 1 段 | 5.8 分钟 | SR 第 1 轮报出预置的 spec 冲突与缺口; Main 按规则停下, 请用户确认 spec 修改 |
| 第 2 段 | 27.7 分钟 | 修 spec 与 issue, SR 第 2 到 7 轮, 实现, 提交审核 4 轮 (中间因撤回越界改动加 SR 第 8 轮); 剩 3 项需用户决定 (未事先估算体积, 一处去重建议, 一处极端精度) |
| 第 3 段 | 1.2 分钟 | 用户接受 3 项, 提交审核第 5 轮通过, 提交 |
| 合计 | 34.7 分钟 | SR 8 轮, 提交审核 (要求符合与 Code Standards 并行) 5 轮; 不含等用户的时间 |

结论: 合格 (60 分钟内), 未达优 (30 分钟). 主要耗时在 SR 多轮 (约 20 分钟) 和提交审核多轮; 场景的 spec 预置了较多缺陷, 轮数偏多在预期内. Reviewer 会话 4 个 (SR, 要求符合, Code Standards, 各跨轮复用) 共约 200 次工具调用, 拒绝 2 次 (`printenv`, `node -e`), 均为只读允许范围外的 Bash, 拒绝消息说明了原因; 没有 Read 被拒.

待决定事项 (未改动, 交 Main Agent):

- (已决定 2026-10-27: Interface 包含字段取值语义) P3: APPLICABILITY 中 "Interface" 是否只指形状; 已有字段的取值变化算不算 Interface 变化; "Module 间数据流" 的措辞. 影响若干误报与漏报的归类.
- (已决定 2026-10-27: 改角色, 不改基准) P4/K5: spec 中对内部缓存或解析算法的长期要求 (调用方不可见) 是否属于就绪缺口 (6 条). 二选一: 改角色第 11 行的长期边界句, 或改答案键与夹具.
- (已核实 2026-10-27: 不是夹具缺陷, qwen_strata 的 SR v4.5 brief 已有判例, 是 worker 复核时未读 brief) K3/K4: 夹具问题: `promotion-runtime.md:97` 依赖验收标准; 保留期起点未定义. 可能是夹具本身的缺陷.
- 答案键外的疑似真实缺陷: `persistence-precondition-failed` 的前提条件未定义; 不可变请求对象. 盲裁已判 supported, 不影响分数.
- 覆盖句 (第 68 行) 的修改可能减弱覆盖压力, 本批未改.

提交阻断: 角色修改按实施工作流提交需要 issue 18 的 Spec Readiness 记录, 本 issue 此前没有. worker 运行了一轮 (haiku high), 结果 6 个 `gap`: 长期规格未作为 Input; `#review-workflow` 锚点包含 ticket 14 到 16 的交付, 选择范围过宽; "Gate 2 漏报记一行" 追加到 spec 末尾会改变 governing-spec 的 sha256, 使已有就绪记录失效, 与 "只在定稿时审核一次" 冲突; 格式取舍的判定标准 (运行次数, 波动) 未定义; spec 第 120 与 122 行对现行格式的规定互斥; spec 第 147 行的授权变化缺少 ADR 结论. 这些需要修 spec 和本 issue 的 `## Spec Requirement`, 超出 worker 范围, 交 Main Agent. 本次只按非实施工作流提交本记录.

偏离: 盲裁模型为 haiku high 而非 benchmark 的 Opus high; 墙钟只测 1 次, Main 用 sonnet (日常 Main 的模型因人而异).

遗留: 本仓库历史提交场景; Strata 正规模式; 另三个场景的盲裁重评.

### 2026-10-27 ticket 26 的审核往返 (收敛优化证据)

ticket 26 按旧规则走: Spec Readiness 8 轮 (第 9 到 12 轮因提交审核修复改 spec 作废重跑), 提交审核 6 轮, 共约 42 分钟. 主要往返来自本 ticket 之前就存在的 Module Design 缺口 (`arw commit-audit verify` 的 Module 责任, Interface 合同, 文本检查归属 Text Policy): 每补一处, Reviewer 就在另一处追问同一既有缺口. 第 7 轮对 "超出复审范围" 的质疑, Reviewer 回复原文: "该条是上一轮已报告的问题; 本轮相邻变化只改动了 `docs/specs/agent-repository-workflow/spec.md:860`, 没有补充该边界理由, 因而问题仍然成立." 没有回答 "检查归属是既有设计" 的证据. 收敛优化应让角色区分本次引入与既有缺口, 并按复审规则限定范围.

### 2026-10-28 第三批 (worker)

体积预估 (不含基准夹具): 净增约 +45 行. Spec Readiness 角色收紧与收敛 (含分发副本) 约 +6, `$reviewer-capability` 盲裁模型一句 +1, 删除 "Gate 2 漏报记一行" (commit Skill 及投影, 分发副本, effort spec) 约 -6, 本记录约 +45. 基准夹具单独报告.

已做:

- Spec Readiness 角色: 应用 `.tmp/t18-sr-role.patch`; 长期规范边界句改为 "spec 对调用方不可见的内部算法, 数据结构或实现策略提出的要求是有效的交付要求"; APPLICABILITY 的 Interface 包含已有字段含义的改变; 覆盖句限定为影响本 issue 交付的缺陷, 并新增交付范围段 (既有合同只在实施或验证必须用到其缺失事实时进入范围). 分发副本同步.
- 删除 "Gate 2 漏报记一行": commit Skill 及投影, 分发副本; effort spec 用户故事 13 (其后重新编号), Review workflow 和 Further Notes 各一条. 长期 spec 中没有该规则.
- 来源分流 (用户 2026-10-28 批准): `docs/agents/subagent-findings.md` 新增 `Triage by origin`, 本次变更既未引入也未影响的既有缺口记入该 effort 的一张后续 issue, 不阻断就绪和提交, 对它不适用 "影响可能不足以证明更改" 的用户决定; 本次引入的问题不论严重度当场修正, 只有超出 ticket 范围的大修正才转 issue. `reviewer.md` 复审只看本轮变化, 仍成立的旧问题写明本轮变化为何没解决, 不重复前轮原文, 报告对既有问题注明 `既有`. commit Skill 和 spec-readiness Skill 引用分流, 只改代码的修复不使就绪记录失效. 质疑规则要求保留既有问题须指出交付对缺失事实的具体依赖.
- `$reviewer-capability` Skill: 盲裁模型至少 sonnet high, 只有本 issue 迁移对比可用 haiku.

Spec Readiness 盲分 (benchmark v2 spec-readiness v4.5 场景, Reviewer haiku high ×2, 裁决 haiku high, 两轮盲池共 69 候选, 锚点 100%, 合成对照全对):

| 运行 | 检出 | clean 误报 | runtime | artifact |
| --- | --- | --- | --- | --- |
| a41 | 19/23 | 3 | 0.64 | 0.773 |
| a42 | 18/23 | 7 | 0.937 | 0.577 |
| 本批合计 | 37/46 | 10 | 0.79 | 0.675 |
| 第二批收紧后 | 33/46 | 6 | 0.90 | 0.48 |

结论: 噪声范围内未下降, 检出和 artifact 上升, clean 误报略增.

完整流程墙钟 (方法同第二批, Main 为 sonnet high, Reviewer haiku high):

- A (只改角色): 第二段 19.7 分钟, Spec Readiness 2 轮 (31, 9 条) 后 Main 停下交 5 项用户决定, 多为既有 spec 缺口. 被来源分流取代, 未继续.
- B (角色 + 来源分流): 第一段 0.5 分钟 (问布局); 第二段 31.1 分钟, Spec Readiness 6 轮 (10, 1, 1, 12, 3, 0 条), 提交审核 2 轮后 Main 停下交 2 项决定; 第三段 4.7 分钟, 第 3 轮两个 Reviewer 均无问题, 场景仓库提交 `90aaa6f`. Agent 墙钟合计约 36.3 分钟 (第二批 34.7), 合格 (≤60) 未达优秀 (≤30).
- 报告中没有出现 `既有` 标记: 该场景实施整份 spec, 来源分流可作用的既有缺口很少, 本次测量不能说明分流节省的时间; 需要在只实施部分 spec 的场景 (如 ticket 26 那类) 上再测.
- 收敛瓶颈: 第 4 轮跳到 12 条, 原因是前 3 轮在 REQUIREMENTS 缺口处提前返回, Module Design 检查到第 4 轮才首次运行, 发现被串行化. 取消提前返回需要改 `lib/spec-readiness` 或角色检查顺序, 列为后续.

范围 1 (替换仓库内 Reviewer 能力套件) 按交接要求停下待定: v2 完整套件体积为 4 个计划物化夹具 273 文件约 754 KB (ARW 布局的变更夹具 263 文件 452 KB), brief 59 KB, 裁决与判断文件约 26 KB, 锚点 459 KB; 评分依赖冻结的 Node 评分器约 5k 行 (与冻结 ARW 耦合), 盲池依赖 qwen_strata 的 Python 工具约 3.1k 行. 现有旧夹具 84 文件 155 KB. 选项: A 按路径和 SHA 引用 qwen_strata v2, 删除旧夹具 (不增体积, 维护者专用, 依赖 qwen_strata 与 Python; 推荐); B 只复制数据约 1.3 MB, 不带评分器; C 全部复制 (约 1.3 MB 加约 8k 行和 Python). 逐文件对比和删除旧夹具等待决定后进行.

偏离: 盲裁用 haiku high (与第二批基线可比); 流程 A 未跑完; "未改 spec 时跳过 Gate 2" 未落地, 因为 `lib/commit-audit` 在 Gate 2 文档非空时拒绝 `gate2Exception`, 需要引擎修改, 列为后续.

遗留: 范围 1 的决定与执行; Gate 2 跳过的引擎修改; Spec Readiness 提前返回导致的串行发现; 部分实施场景上的分流时间测量; 本仓库历史提交场景; Strata 正规模式; 另三个场景的盲裁重评 (按新规则须 sonnet high 以上).

提交审核 (`requirements-reviewer` haiku high, 一轮): 运行时拒绝空 `issueIds`, 与 commit Skill 规则例外冲突, 改用 `issue:0001:18` 身份. 6 个问题都属本次引入, 处理如下.
- 已修正: 分流 (b) 改为 "引入或影响"; Reviewer 按角色范围不报告的既有内容 (Code Standards 的历史问题, Spec Readiness 交付范围外的既有设计) 不产生问题; Reviewer 以具体依赖保留的既有问题按本次影响的问题修正, 避免 `gap` 无法解除; spec-readiness Skill 的 Module Design 适用性写明 Interface 含字段含义改变.
- 未改: 长期 spec 第 164 行同步同一说明会改变其 sha256, 使绑定它的未完成就绪记录失效, 列为后续; 第 525, 856 行 "问题都已处理" 已涵盖记入后续 issue; domain-modeling 第 92 行约束作者不写实现细节, 角色第 11 行只规定 spec 已写的此类要求不算就绪缺口, 两者不冲突.
