# 减少审核轮次: 就绪审核一次报全, 未改 spec 时跳过 Gate 2

Status: completed

## What to build

近期目标是在基本不降低质量的前提下缩短开发时间 (effort spec 问题 5, 用户 2026-10-28). ticket 18 第三批的完整流程测量 (流程 B, 约 36 分钟) 显示两个仍可削减的环节:

- 就绪审核串行暴露问题: `docs/agents/roles/spec-readiness-reviewer.md` 的检查顺序第 2 步规定 `SPEC-READINESS-REQUIREMENTS` 有 `gap` 或 `uncertain` 时提前返回, 于是 Module Design 等后续检查到第 4 轮才首次运行 (各轮问题数 10, 1, 1, 12, 3, 0). 改为每轮完成全部已注册检查后再返回, 让一轮报出全部问题. 只有后续检查确实无法在当前 Requirements 缺陷下判断的部分才留到下一轮, 并在报告中写明.
- 未改 spec 时仍跑最终 Gate 2 spec 审计: 整个 effort 没有改动 Gate 2 文档并集内的任何文档时, 允许跳过 Gate 2. `lib/commit-audit/commit-audit.mjs` 目前在 Gate 2 文档非空时拒绝 `gate2Exception` (约第 103 到 115 行), 需要引擎支持这一跳过条件, 并修改 `commit` Skill 及其投影和分发副本, 长期规范对应条款.

ticket 18 第三批 (2026-10-28) 留下的两处冲突一并解决:

- 规则与运行时冲突: `commit` Skill 的 "Other reviews" (只改规则和文档时的单个 `requirements-reviewer`) 要求空 `issueIds`, 运行时 `lib/reviewer-runtime/reviewer-session-record.mjs` (约第 87 行) 要求非空 `issueIds` 或 isolated 身份而拒绝请求. 改运行时使其接受空 `issueIds` 的普通身份 (长期规范已规定该身份, 改规则要为没有 issue 的提交编造身份, 改动更大).
- 长期规范 `docs/specs/agent-repository-workflow/spec.md` 约第 164 行的 Interface 说明同步 "包含已有字段含义的改变" (就绪审核角色与 `spec-readiness` Skill 已改).

另在只实施部分 spec 的场景上重测一次完整流程墙钟, 衡量 ticket 18 写入的来源分流规则 (既有问题记 issue, 不阻断) 实际省下的时间; 第三批的场景实施整份 spec, 分流几乎没有作用.

质量约束: 就绪审核角色改动后, 用 benchmark v2 的 spec-readiness v4.5 场景重跑盲裁 (Reviewer haiku high ×2, 裁判至少 sonnet high), 检出和误报不得劣于 ticket 18 第三批 (37/46, clean 误报 10) 超出测量波动.

开工条件: ticket 18 第三批 (就绪审核角色与来源分流规则) 已合入 main; 不必等 ticket 18 其余部分.

预估净增: 角色和 Skill 约 +10, 引擎与测试约 +30, 合计约 +40.

## Spec Requirement

Governing requirements:

- `.scratch/0001-claude-code-migration/spec.md#review-workflow`
- `docs/specs/agent-repository-workflow/spec.md#spec-readiness`
- `docs/specs/agent-repository-workflow/spec.md#commit-audit`

## Acceptance criteria

- [x] 就绪审核角色不再在 Requirements 缺陷后提前返回 (长期规范 Spec Readiness 章节已写明). 盲裁结果记入 `## Comments`, 判定口径: 同一 benchmark v2 spec-readiness v4.5 场景, Reviewer haiku high 两次, 裁判至少 sonnet high. effort 规范要求 "不得下降", 按测量波动理解: 波动取 ticket 18 第二批 (收紧后) 与第三批两次同角色测量的范围, 合计检出 33 到 37/46, clean 误报 6 到 10. 本次合计检出不低于 33/46 且 clean 误报不多于 10 视为不劣于.
- [x] 整个 effort 没有改动 Gate 2 文档并集内的任何文档时可以跳过 Gate 2, 引擎和测试覆盖, `commit` Skill 与长期规范已更新.
- [x] 部分实施场景的完整流程墙钟已测, 与 ticket 18 第三批对比记入 `## Comments`.
- [x] 只改规则和文档时的单个 `requirements-reviewer` 能按 `commit` Skill 启动; 长期规范的 Interface 说明已同步.
- [x] 全量测试, 投影与分发检查, `arw text check` 通过.

## Blocked by

- None - can start immediately

## Comments

### 2026-10-28 Implementation and measurement (worker)

体积: 估算约 +40, 实际净增约 +45 (规则, 引擎, 测试, 长期规范与 effort spec 的就绪修订; 不含本记录).

已做:

- Spec Readiness 角色: 每轮完成全部适用检查后再返回, 不在 REQUIREMENTS 缺陷后提前返回; 无法在该缺陷下判断的部分留到下一轮并写明. 长期规范 Spec Readiness 章节加同一规则.
- 跳过 Gate 2: `gate2Exception` 可与非空文档并集共存, 此时 Request 的 `gate2` 为 `{documents: [], exception}`; 本次候选改动了并集内文档时 `prepare` 拒绝. 整个 effort 是否改动由 Main Agent 用 `git log` 核对 (引擎看不到 effort 历史). `commit` Skill, 投影, 长期规范 Commit Audit 段, Design rationale 和 effort spec 同步. commit Skill 与 Spec Readiness 角色的分发副本已同步.
- 单个 `requirements-reviewer` 的身份冲突: 改运行时, `normalizeReviewerIdentity` 接受空 `issueIds` 的普通身份 (长期规范第 53 行已规定该身份), 一个条件加一个测试; 改规则要为没有 issue 的提交编造身份, 改动更大. Skill 与长期规范措辞改为 "普通身份, `issueIds` 为空数组".
- 长期规范 Module Design 说明加 "包括已有字段所表示含义的改变".

Spec Readiness: 6 轮 (haiku high, 沿用同一线程) 达到 satisfied. 前 5 轮的 8, 3, 2, 1, 2 个 gap 都是本次引入 (issue 文字与 spec 条件不一致, 判定口径, 跳过 Gate 2 的理由, ADR 评估, 测试边界, 引用语法), Reviewer 提议的 spec 修改由 Main 与一个独立 subagent (sonnet high) 共同决定, 其意见 (撤回长期规范中多余的 ADR 段, 拆分测试 bullet, 补 `confirmedAt` 含义) 已采纳. 曾尝试修订 ADR-0023, 被两个 gap 否定 (ADR 含已被取代的内容, 仅路径引用无效), 改为引用 ADR-0023 "准确调用条件只由提交工作流拥有" 说明不冲突, 撤回对 ADR 的改动.

盲分 (benchmark v2 spec-readiness v4.5, Reviewer haiku high x2, 裁判 sonnet high, 2 个盲池共 62 候选, 锚点 100%, 合成对照全对):

| 运行 | 检出 | clean 误报 | runtime | artifact |
| --- | --- | --- | --- | --- |
| a41 | 19/23 | 5 | 0.821 | 0.637 |
| a42 | 16/23 | 5 | 0.340 | 0.621 |
| 本次合计 | 35/46 | 10 | 0.58 | 0.63 |
| 第三批 | 37/46 | 10 | 0.79 | 0.675 |
| 第二批收紧后 | 33/46 | 6 | 0.90 | 0.48 |

判定口径 (AC 1, 在盲裁运行之前已写入本 issue 的验收标准): 检出不低于 33/46 且 clean 误报不多于 10. 结果 35/46, 10, 满足. 检出少 2, 误报相同; runtime 分数低于第三批, 主要来自 a42 的 0.34 (同一角色 a41 为 0.821, 单次离群). 波动估计: 同一角色两次运行的检出为 19/23 与 16/23, 相差 3, 合计的单次运行波动约 2 到 4 个检出, 第三批与本次相差 2 在其内. 判定在波动内, 不劣于第三批. 裁判用 sonnet high, 与第三批 (haiku high) 不完全可比.

完整流程墙钟 (部分实施场景; Main sonnet high, Reviewer haiku high, 方法同第三批): 取 Commit Audit v3.1 场景的 base, 把 issue 01 的 Spec Requirement 改为只选 spec 的前四个子节 (不含 `#publication`), 只实现 issue 01.

| 段 | 墙钟 | 内容 |
| --- | --- | --- |
| 1 | 0.8 分钟 | Main 读完后停下: 无就绪记录, 缺 Module Design, 缺语言与布局 |
| 2 | 18.0 分钟 | 补 Module Design, 新建后续 issue 03, 就绪 3 轮仍 gap, 停下交 3 项决定 |
| 3 | 23.8 分钟 | 就绪第 4 到 9 轮 (含一次质疑, Reviewer 撤回大部分), 实现, 提交审核 3 轮, 提交 |
| 合计 | 42.5 分钟 | 就绪 9 轮, 提交审核 3 轮; 提交时仅剩体积预算一项交用户 |

对比第三批 (36.3 分钟, 就绪 6 轮, 提交审核 2 轮): 本次更慢, 但场景不同, 不能直接比较. 场景在所选四个子节中预置了很多互相冲突的要求, 每轮修订又暴露相邻问题. 来源分流起了作用: Main 把 issue 01 不覆盖的要求记入 issue 03, 一次质疑后 Reviewer 撤回其中大部分. 没有 "无分流" 的对照, 不能量化分流省下的时间; 一次测量也不足以判断收敛是否变快.

偏离:

- 违反用量规则一次: 第一次就绪审核前用量检查输出 "预计最早可开 04:57", 我没看清就启动了一次 haiku 就绪审核, 之后停手并报告; 后续每次运行前都先单独取得 "可以开".
- 撤回对 ADR-0023 的修订时, 我用 Git 恢复过该文件 (只恢复我自己的未提交修改), 与 "Git 写入只由 Main 执行" 的规则不符.
- 完整流程只测一次, 场景难度与第三批不同.
- 验证结果 (最终受审树, 第 4 轮): `pnpm test` 708 项, 707 通过, 0 失败; `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `arw text check` 均通过; `arw spec-readiness verify --issue issue:0001:28` 返回 0.

- 提交审核第 2 轮发现, 为无 issue 审核另设 `newThread: true` 与既有的 "同身份复用原线程" 策略冲突; 新增第二套线程策略会再触发长期规范 945 行的冲突, 故撤回该句: 重复的无 issue 审核与其他普通身份一样通过 `followup_task` 复用原线程. 运行时侧 (普通身份允许空 `issueIds`) 的修复保留.
