# 修复记录存档与忽略规则中的本机路径

Status: wontfix

## What to build

实现 effort spec 的 Portable format baseline archive 节.

1. `tests/fixtures/reviewer-capability/format-baseline/archive/**` 下 20 份 `*.changes.json`: `original` 改为 `registry.json` 中同一报告条目的 `report` 值; 含 `normalized` 的 3 份把它改为 `<report 所在目录>/repair/<报告文件名>`. 其他字段字节不变, 文件保持 `JSON.stringify(record, null, 1)` 加结尾换行的格式.
2. `tests/fixtures/reviewer-capability/format-baseline/registry.json`: 只把受影响条目的 `changesSha256` 更新为改写后文件的 SHA-256, 其他字节不变 (只替换哈希字符串, 不重新序列化整个文件).
3. `.gitignore`: 删除 `# 状态页` 注释, `.status/` 条目和它们之前的空行, 其他行不变.

改写可用放在 `.tmp/` 下的一次性脚本完成, 完成后删除, 不提交. 存档报告, 溢出文件, 答案键, 计分实现和测试都不改.

体积预算: 非测试代码净增 0 行 (存档是测试数据; `.gitignore` 删除 3 行配置不计入代码).

预期验证: 改动前后各运行一次 `node scripts/reviewer-capability.mjs baseline <unit>`, `<unit>` 依次为 `code-spec`, `code-standards`, `commit-audit`, `spec-readiness`, 输出必须相同且都是 `succeeded`; `node --test tests/reviewer-capability/format-penalty.test.mjs`; Source Checkout 完整验证 `pnpm test`, `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`. 不涉及 Reviewer 规则, 不做 Reviewer 能力对比. 修改 `tests/fixtures/reviewer-capability/**` 前按根 `AGENTS.md` 的触发读取 `docs/agents/source-checkout-exceptions.md`.

边界情况: 漏改某个 `changesSha256` 时 `baseline` 以登记不符失败; 改动不得触及 `original_sha256`, 否则 `baseline` 报告修复记录来自另一份报告; `registry.json` 的格式和其他哈希必须逐字节保留.

## Acceptance criteria

- [ ] `git grep -n -I -e "/home/" -e "/mnt/[a-z]/" -- tests/fixtures/reviewer-capability/format-baseline` 没有输出.
- [ ] 每份修复记录的 `original` 等于其登记条目的 `report`, 3 个 `normalized` 符合第 1 项规则; `git diff` 中修复记录只有这两个字段的行变化, `registry.json` 只有 `changesSha256` 行变化.
- [ ] 四个单元的 `baseline` 命令都返回 `succeeded`, 输出与改动前相同.
- [ ] `.gitignore` 不再含 `.status/` 和状态页注释, 其他行不变.
- [ ] 预期验证中的测试与检查命令全部成功.

## Blocked by

- None - can start immediately

## Comments

- 规划记录: 本 issue 只改测试数据和忽略规则, 没有设计决定. 用户明确确认不需要治理设计时, 可按 `spec-readiness` Skill 的 Exception workflow 记录 `not-applicable`, 省去就绪审核; 否则以 effort spec 为治理 spec 运行 Spec Readiness.
- 2026-11-02 不在本 effort 处理: 原样移到 issue:0024:01 单独成 effort, 以便使用 Spec Readiness 例外.
