# 把确需的用户级规则写入 ARW

Status: completed

## What to build

ARW 启动的 Agent 不载入维护者本机的用户级规则, 其中对所有 ARW 使用者都成立的几条, 以及只对本源码仓库维护成立的几条, 需要写进 ARW 自己的规则. ARW 不以尽量让 Agent 全自动工作为目标, 与用户沟通的首选方式是 `grilling`, 因此自主推进, 状态页, 自动决策类的用户级规则不写入. 这是一组纯规则文本改动, 决定已由维护者和 Main Agent 作出, 不含新的设计决定, 不写 spec. 措辞遵循 `docs/agents/writing.md`: 中文, ASCII 标点, 不含本机路径和本机工具.

分发规则 (分发副本由源头同步, 不手改派生副本):

1. 根 `AGENTS.md` managed 区 Workflow Triggers 节首段: 补充上下文压缩后压缩前读过的触发内容视为未读, 再到触发点时重新读取, 即使摘要说已读或引用了片段. 来源: 用户级 Reading triggers 规则. 分发副本 `distribution/baseline/AGENTS.md` 随之变化.
2. `to-tickets` Skill 第 5 步 (写 issue) 末尾: `## What to build` 和验收标准写到用户请求要求的最终状态, 不只写第一步, 写完对照用户原话, 确认每项请求都有对应的验收标准. 来源: 记录终态而非第一步的维护经验 (一个 issue 只记录了中间步骤, 终态漏记). 分发副本 `distribution/skills/to-tickets/SKILL.md` 随之变化.
3. 根 `AGENTS.md` managed 区 Important Decisions 节末: 照规则执行某一步很可能失败时, 不硬做, 先说明失败原因, 提出等效变通方案及成本, 用 `grilling` 取得授权后再执行. 来源: 维护经验 "规则步骤很可能失败时先提变通方案". `distribution/baseline/AGENTS.md` 随之变化.
4. `issue-tracking` Skill 中说明 effort 编号与重用的第一节 (`## Artifact model`): 一个 effort 只承载一个主要目标, 不相关的目标另建 effort. 来源: 同上经验的后半. 与 `docs/agents/agent-writes.md` Issue concurrency 节 "小 issue 可合并" 是不同层级 (effort 与 issue). `distribution/skills/issue-tracking/SKILL.md` 随之变化.
5. `rule-and-design-changes` Skill Writing durable documents 节: 新增规则前先确认它会改变 Agent 朝目标的行为, 只涉及外观或格式的问题直接改正文, 不新增规则. 来源: 维护经验 "只为影响结果的问题加规则". `distribution/skills/rule-and-design-changes/SKILL.md` 随之变化.

源码仓库维护规则 (不分发):

6. 根 `AGENTS.md` repository-owned 区 Source Checkout Validation 节, 接在 "单个测试回调耗时阈值为 100 毫秒" 之后: 作为 `validation` Skill 逐例批准要求的 Baseline 例外, 本仓库不为缩短测试耗时修改生产代码 (含为测试增加的注入接缝); 不改生产代码就降不到阈值以下的测试保留超时, 不逐例请求批准. 来源: 维护者 2026-11-02 的常设例外. 不写 "git 与子进程默认 mock", 因为 `.agents/skills/test-performance-optimization/SKILL.md` 与 `tdd/mocking.md` 已覆盖.
7. `reviewer-capability` Skill Run 第 1 步: 改动前后的评分对比 (A/B, 回归) 的 Reviewer 各组用 Claude `haiku` `high`, 不用 Codex `gpt-6-luna`, 因为 luna 分数波动过大 (同一对照组 0.285, 正常约 0.54), 区分不了两组. 来源: 维护者 2026-10-29 的决定. 这只约束测量方法, 不改变 Reviewer 行为, 不做能力测试.

分析中的 "发布成功后更新 agent-assisted fixture" 已在 `.agents/skills/release/references/fixtures.md` 的 Update after a successful release 节和 `release` Skill 第 5 节中存在, 本 issue 不改.

预期验证: 运行 `docs/agents/source-checkout-validation.md` 中只含 Agent 规则与文档的提交须跑的三个 `node scripts/` 检查, 以及 `node arw.mjs text check` 和 `git diff --check`; 检查改动文本不含本机路径和本机工具名.

体积预算: 文档字符净增约 600 (不含由源头同步的派生副本).

## Acceptance criteria

- [x] 上述 7 处改动都写入各自的目标文件, 措辞符合要点.
- [x] 分发副本与 `.claude/skills/` 投影与源头一致, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check` 通过.
- [x] `node arw.mjs text check` 与 `git diff --check` 通过.
- [x] 改动文本不含本机路径, 本机工具名和自主推进, 状态页类规则.
- [x] 文档字符净增不超过预算, 超出时在 `## Comments` 说明.

## Blocked by

- None - can start immediately

## Validation

- `node scripts/check-workflow-distribution.mjs`: 通过 (退出码 0).
- `node scripts/project-claude-skills.mjs --check`: 通过; 此前运行过 `node scripts/project-claude-skills.mjs` 重新生成 `.claude/skills/`.
- `node scripts/generate-install-arw.mjs --check`: 通过.
- `node arw.mjs text check`: 通过, 检查 905 个文本文件.
- `git diff --check`: 无输出.
- `node arw.mjs terms check --include .scratch/0064-user-rule-adoption/`: 通过 (首次发现 `Artifact` 一词在正文中使用, 已改写后重跑通过).
- 文档字符净增 (源头文件 `wc -m` 与 `HEAD` 之差): `AGENTS.md` +271, `issue-tracking` +40, `reviewer-capability` +127, `rule-and-design-changes` +65, `to-tickets` +77, 合计约 +580, 低于预算约 600.
- 改动文本不含本机路径, 本机工具名, 自主推进与状态页类规则, 由人工核对.
- 未运行 `pnpm test`: 本 issue 只改规则文本.
- Main 暂存源头后运行 `node scripts/sync-workflow-distribution.mjs` 与 `node scripts/project-claude-skills.mjs`, 派生副本只随源头变化; 提交审核第 1 轮修复后再次运行, 三个 `node scripts/` 检查, `node arw.mjs text check`, `git diff --check` 通过.

## Comments

- 用户确认: 维护者 2026-11-04 定 ARW 启动的 Agent 不载入本机用户级规则, 确需的写进 ARW, 且 ARW 不追求全自动, 状态页与自动决策不写, 与用户沟通首选 grilling. Main Agent 采纳独立分析中的规则, 写成上文第 1 至 5 条分发规则和第 6, 7 条源码维护规则, 并据此向实施 worker 下达改动内容; 按根 `AGENTS.md` Source Checkout Baseline 例外, Main Agent 的确认等同用户确认, 本条为确认依据.
- 实施发现: 分析中的第 2 节第 2 条 (发布后更新 fixture) 已有等价规则, 未改动, 实际改动 7 处.
- 分发副本同步: `node scripts/sync-workflow-distribution.mjs` 在改动未暂存时拒绝运行 (`sync-input-dirty`), 实施 worker 不做 Git 写入, 所以按同一内容直接写入派生副本 (`distribution/baseline/AGENTS.md` 为 managed 区原样加上 repository-owned 占位, 三个 Skill 为整文件复制), 已由生产检查确认一致. Main 暂存后可重跑同步脚本确认无差异.
- Main Agent 核对: 第 4 条与 `docs/agents/agent-writes.md` Issue concurrency 节 "内容不相关的小 issue 也可以合并" 冲突 (合并后的 issue 落在同一 effort), 在第 4 条补 "为减少审核轮次合并实施的小 issue 不受此限", 保留两边现有行为. 暂存后重跑 `node scripts/sync-workflow-distribution.mjs` 与投影, 派生副本只随这一处变化.
- 就绪例外依据: 维护者 2026-11-02 (`confirmedAt` 2026-11-02T05:10:54Z) 对一类 issue 作出常设确认, 原话 "用户已确认这类 issue 不需要治理设计", 范围是不含设计决定且不依赖共用 spec, 各自单独成 effort 的 issue. `spec-readiness` Skill 的 Exception workflow 节允许用户事先对一类 issue 作出的常设确认, `confirmedAt` 写该常设确认作出的时间. 本 issue 只把维护者已决定的内容写成规则文本, 不含新的设计决定, 属于这一类.
- 测量依据 (第 7 条): luna 在同一对照组上得分 0.285, 正常约 0.54, 区分不了两组.
