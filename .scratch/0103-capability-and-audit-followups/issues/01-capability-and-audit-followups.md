# 清理合并审核转入的后续项

Status: completed

## What to build

本 effort 只含本 issue, 不创建 spec. 用户已事先确认这类无设计决定的 issue 不需要治理设计 (2026-11-02), 就绪审核通过例外流程记录 `not-applicable`. 处理 effort 0100 issue 02 与 effort 0101 提交审核台账中记为 "转入后续 issue" 的五项, 每项已逐一核实仍然成立:

- `lib/reviewer-runtime/reviewer-native-policy.mjs` 的 `reviewerNativeSettings` 只用 `cwd` 和 `writePaths`, 但 JSDoc 类型仍把 `readPaths` 声明为必填. 从类型中删去 `readPaths`, 并去掉 `tests/reviewer-runtime/reviewer-native-policy.test.mjs` 中只为满足该类型而传的 `readPaths: []`. 不改变 Reviewer 运行器对 `readPaths` 的校验和字段本身.
- `lib/reviewer-capability-setup.mjs` 三处内联的 `{diagnostics, status: 'blocked'}` (两处) 和 `{diagnostics, stage: 'scenario-build', status: 'failed'}` 改用 `lib/reviewer-capability/results.mjs` 已有的 `blocked` 与 `failed`, 结果字节不变.
- `docs/specs/agent-repository-workflow-development/spec.md` 的 `inspect` 一节写 "读取已存在文件的 I/O 失败是 `failed` (`stage` 为 `report-read`, 夹具为 `fixture-read`)", 但 #588 与 `lib/reviewer-capability/inspection.mjs` 的行为是读取夹具或 `agent.json` 以外的实例文件失败都报告 `fixture-read`, `agent.json` 与原生记录读取失败报告 `report-read`. 把该句改成与行为一致, 不改代码行为.
- `tests/commit-audit/cli.test.mjs` 的忽略规则测试里嵌套 `.gitignore` 的 `ignored.txt` 与 `!included.txt` 互不重叠, 否定规则从未起作用. 改成 `*.txt` 加 `!included.txt`, 使否定规则决定结果.
- `lib/commit-audit/commit-audit.mjs` 的 `standardsPaths` 把 effort 的 `prototype/` 与 `research/` 文件排除在 Code Standards 路径之外, 没有测试. 补一个测试: 候选含 `.scratch/<effort>/prototype/` 和 `research/` 文件与普通代码文件时, Code Standards Reviewer 的纳入路径只含普通代码文件.

体积预算: 非测试代码净增不超过 +2 行 (只合并与删减), 测试约 +30 行, 文档约 +22 字符. 不扩大范围, 不改生产行为.

预期验证: `reviewer-native-policy`, `reviewer-capability` 相关测试, `tests/commit-audit/cli.test.mjs` 定向运行, 完整 `pnpm typecheck` 和 `pnpm test`, `arw text check`, `arw terms check`, `git diff --check`. 边界: setup 的两个 `blocked` 和一个 `failed` 的输出结构与退出值不变.

## Acceptance criteria

- [x] `reviewerNativeSettings` 的类型不再声明 `readPaths`, 调用方和测试仍通过类型检查.
- [x] `lib/reviewer-capability-setup.mjs` 不再内联同形结果, 现有 setup 测试通过.
- [x] spec 的 `inspect` 一节与 #588 的 `fixture-read` 行为一致.
- [x] 忽略规则测试中否定规则决定 `included.txt` 的结果.
- [x] 有测试证明 effort 的 `prototype/` 与 `research/` 文件不进入 Code Standards 纳入路径.
- [x] 完整 Source Checkout 验证通过, 完成记录含体积分类.

## Blocked by

- None - can start immediately

## Validation

- 逐项核实 (实施前): 五项均仍成立. `readPaths` 在 `reviewerNativeSettings` 中未使用而类型必填; setup 中确有三处内联结果; spec 句只把 `fixture-read` 限于夹具, 而 `fingerprints` 遍历实例目录 (`agent.json` 除外, 其读取失败为 `report-read`) 的读取失败返回 `fixture-read`; 嵌套 `.gitignore` 的 `ignored.txt` 不匹配 `included.txt`, 否定规则无作用; `EFFORT_AUXILIARY_PATH` 没有测试.
- `node --test --test-isolation=none tests/commit-audit/cli.test.mjs tests/reviewer-runtime/reviewer-native-policy.test.mjs`: 32/32 通过, 新增案例约 41 毫秒. 变异检查: 把 `EFFORT_AUXILIARY_PATH` 改为不匹配任何路径时新测试失败; 删去 `!included.txt` 时忽略规则测试失败, 说明否定规则现在决定结果.
- `pnpm typecheck`: 通过. `pnpm test`: 935/935 通过, 0 失败.
- `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `node arw.mjs text check`, `node arw.mjs terms check --include .scratch/0103-capability-and-audit-followups/`, `git diff --check`, 受影响 `.mjs` 的 `node --check`: 通过.
- 体积: 非测试代码净增 +1 行 (setup 增一行导入, 其余原位替换), 测试净增约 +13 行, 文档约 +22 字符.

## Comments

第 1 轮提交审核: 要求符合 Reviewer 指出 spec 句把 `agent.json` 读取失败也归为 `fixture-read` 不准确, 实现与测试中 `agent.json` 为 `report-read`; 已改句并同步改 What to build 的措辞. 两个 Reviewer 都指出文档体积超出 "文档不增" 的初始预算; 该句必须多表达 `fixture-read` 的适用范围与 `agent.json` 例外, 无法在不增字符下表达, 已把预算改为约 +22 字符, 实测 spec.md +22 字符.

台账: docs/specs/agent-repository-workflow-development/spec.md:325 文档净增 22 字符超出初始 "文档不增" 估计 记录不修 初始估计只按改写 "夹具为" 三个字计, 漏计 `agent.json` 例外 (第 1 轮要求符合审核证实 `agent.json` 读取失败为 `report-read`); 句中 "夹具与 `agent.json` 以外的实例文件" 是表达该范围的最短写法, 原句其余部分是既有合同文字, 删减会改变 spec 含义. 根 AGENTS.md 体积预算规则允许无法再削减时记录超出量, 已在 What to build 与 Validation 同步为 +22 字符.
