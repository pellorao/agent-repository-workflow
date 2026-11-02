# Status 行与 Blocked by 章节的定位与解析器一致

Status: completed

## What to build

问题: 解析器 (`readMetadata`) 读取 `Status` 时允许非规范空白 (`Status:completed`, `Status:  completed`, 行尾空格), 但 `locateStatusLine` 只接受恰为 `Status: <status>` 的一行, 所以通过清单核对的合法记录在 Application Sync 以 `application-status-replacement-invalid` 或在 Application Association 以 `association-document-invalid` 中止. 同类不一致: `locateBlockerSection` 用 `## Blocked by` 精确相等, 解析器的 `findSections` 先做 trim.

方案 (已定, 不改读取接受的格式): `locateStatusLine` 复用解析器的 plain `Status` 条目及其行号 (`indexIssueText(text).metadata.status`, 只取 `syntax === 'plain'`, 恰好一条且值等于当前状态); 改写输出规范的 `Status: <status>` (同步和关联两处调用方都输出规范行; 范围是 "该行被改写时输出规范行": 同步仅在状态变化时改写, 状态相同分支保留原文). `locateBlockerSection` 改为围栏外 `## ` 标题加 trim 后精确匹配 `## Blocked by`, 与 `findSections` 一致. 关联的 `association-document-invalid` 文案改为 "does not contain exactly one plain Status line matching the issue status and exactly one Blocked by section."; 同步的诊断文案不变.

体积预算 (非测试代码行): 净增约 0 行; 上限 +5.

预期验证: 同步和关联各新增一个非规范空白用例和一个粗体混排用例 (粗体行不被改写, 只改 plain 行); 既有 Status 围栏, CRLF 用例不变通过.

## Acceptance criteria

- [x] 非规范空白的 plain `Status` 行在同步和关联中被识别, 且该行被改写时输出 `Status: <status>` (同步只在状态变化时改写).
- [x] 含孤立 `\r` 的文本不改写 `Status` 行 (定位返回 null, 调用方沿用原诊断). 依赖规范化在 `locateBlockerSection` 自己的切分上定位和改写, 行号不会错位, 不在本条范围内.
- [x] `## Blocked by` 带行尾空白时关联可定位该章节.
- [x] 粗体 `**Status:**` 行不影响定位也不被改写; 新增测试覆盖上述情形.

## Blocked by

- None - can start immediately

## Validation

- 验收条件 1: `tests/application-jira/application-sync.test.mjs` 新测试 "Application Sync rewrites a non-canonical plain Status line ..." 和 `application-association.test.mjs` 新测试 "Application Association accepts non-canonical Status and Blocked by whitespace ..." 通过 (`Status:   ready-for-agent  `, `Status:ready-for-agent ` 均被识别).
- 验收条件 2: 同一关联测试用 `## Blocked by  ` (行尾空白) 通过.
- 验收条件 3: 两个测试的粗体混排用例通过, `**Status:**` 行原样保留.
- 提交审核第 1 轮: (1) 孤立 CR 会让解析器 (归一化换行) 的行号与 `split('\n')` 错位, `locateStatusLine` 对含孤立 `\r` 的文本返回 null, 新增同步和关联各一个回归测试 (去掉守卫时失败); (2) 抽出 `locateSections` (`issue-documents.mjs`, 返回 `{start,end}`), `findSections` 与 `locateBlockerSection` 共用, 删除重复定位代码, `end` 改为无后续标题时等于行数; (3) 验收条件 1 的范围改为 "该行被改写时", 无代码改动.
- 体积: 非测试代码 `git diff --numstat` 共 +23 -33, 净减 10, 在上限 +5 内.
- 全量: `pnpm test` 829 通过, `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `arw text check`, `arw terms check --include .scratch/0030-status-line-locate-parser/` 通过. 新测试均不到 5 ms. 就绪记录为 `not-applicable` 例外 (用户 2026-11-02 确认).

## Comments

- 就绪记录 (`not-applicable` 例外) 在实现改动之后才生成, 与 "首次修改实现文件前取得就绪结果" 的顺序不符. 维护者 2026-11-02 已追认这一偏离.
- 提交审核第 2 轮: 验收条件 2 的范围收窄为 `Status` 行定位 (依赖规范化路径与其切分一致, 不会错位改写); 体积记录按受审树更新.
