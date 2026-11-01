# 修复记录存档与忽略规则中的本机路径

Status: completed

## What to build

Reviewer 能力测试的格式基线存档里, 修复记录的 `original` 和 `normalized` 记录的是生成存档那台机器上的绝对路径, `.gitignore` 里还有只对某台机器有意义的状态页条目. 改为仓库相对路径并删除该条目, 使存档对任何克隆都成立; 计分结果不变.

1. `tests/fixtures/reviewer-capability/format-baseline/archive/**` 下 20 份 `*.changes.json`: `original` 改为 `registry.json` 中同一报告条目的 `report` 值; 含 `normalized` 的 3 份把它改为 `<report 所在目录>/repair/<报告文件名>`. 其他字段字节不变, 文件保持 `JSON.stringify(record, null, 1)` 加结尾换行的格式.
2. `tests/fixtures/reviewer-capability/format-baseline/registry.json`: 只把受影响条目的 `changesSha256` 更新为改写后文件的 SHA-256, 其他字节不变 (只替换哈希字符串, 不重新序列化整个文件).
3. `.gitignore`: 删除 `# 状态页` 注释, `.status/` 条目和它们之前的空行, 其他行不变.

改写可用放在 `.tmp/` 下的一次性脚本完成, 完成后删除, 不提交. 存档报告, 溢出文件, 答案键, 计分实现和测试都不改.

体积预算: 非测试代码净增 0 行 (存档是测试数据; `.gitignore` 删除 3 行配置不计入代码).

预期验证: 改动前后各运行一次 `node scripts/reviewer-capability.mjs baseline <unit>`, `<unit>` 依次为 `code-spec`, `code-standards`, `commit-audit`, `spec-readiness`, 输出必须相同且都是 `succeeded`; `node --test tests/reviewer-capability/format-penalty.test.mjs`; Source Checkout 完整验证 `pnpm test`, `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`. 不涉及 Reviewer 规则, 不做 Reviewer 能力对比. 修改 `tests/fixtures/reviewer-capability/**` 前按根 `AGENTS.md` 的触发读取 `docs/agents/source-checkout-exceptions.md`.

边界情况: 漏改某个 `changesSha256` 时 `baseline` 以登记不符失败; 改动不得触及 `original_sha256`, 否则 `baseline` 报告修复记录来自另一份报告; `registry.json` 的格式和其他哈希必须逐字节保留.

## Acceptance criteria

- [x] `git grep -n -I -e "/home/" -e "/mnt/[a-z]/" -- tests/fixtures/reviewer-capability/format-baseline` 没有输出.
- [x] 每份修复记录的 `original` 等于其登记条目的 `report`, 3 个 `normalized` 符合第 1 项规则; `git diff` 中修复记录只有这两个字段的行变化, `registry.json` 只有 `changesSha256` 行变化.
- [x] 四个单元的 `baseline` 命令都返回 `succeeded`, 输出与改动前相同.
- [x] `.gitignore` 不再含 `.status/` 和状态页注释, 其他行不变.
- [x] 预期验证中的测试与检查命令全部成功.

## Blocked by

- None - can start immediately

## Validation

- 验收 1: `git grep -n -I -e "/home/" -e "/mnt/[a-z]/" -- tests/fixtures/reviewer-capability/format-baseline` 无输出 (退出码 1).
- 验收 2: 一次性脚本逐文件断言改前能按 `JSON.stringify(record, null, 1)` 加结尾换行逐字节还原, 且改前哈希等于登记值; `registry.json` 只做哈希字符串替换. `git diff -U0 -- tests/fixtures` 中变化行为 20 个 `original`, 3 个 `normalized`, 20 个 `changesSha256` (各自成对增删), `registry.json` 中除 `changesSha256` 外没有变化行; 共 21 个文件改动 (20 份修复记录和 `registry.json`), 没有触及 `original_sha256`, 存档报告, 溢出文件, 答案键, 计分实现或测试.
- 验收 3: 改动前后各运行 `node scripts/reviewer-capability.mjs baseline <unit>`, `<unit>` 为 `code-spec`, `code-standards`, `commit-audit`, `spec-readiness`; 四个单元的退出码都是 0, `status` 都是 `succeeded`, 改前改后输出逐字节相同 (`cmp`).
- 验收 4: `git diff .gitignore` 只删除 `# 状态页`, `.status/` 和它们之前的空行共 3 行.
- 验收 5: `node --test tests/reviewer-capability/format-penalty.test.mjs` (30 个通过), `pnpm test` (814 个通过), `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check` 全部成功; 另外 `arw text check` 和 `arw terms check --include .scratch/0024-portable-format-baseline/` 通过. 本 issue 不涉及 Reviewer 规则, 未做 Reviewer 能力对比.
- Spec Readiness: 已按 Exception workflow 记录 `not-applicable`, `arw spec-readiness verify --issue issue:0024:01` 退出码 0.

## Comments

- 规划记录: 从 issue:0023:02 移出单独成 effort (原 effort 有多个 issue, Spec Readiness 例外不适用). 本 issue 只改测试数据和忽略规则, 没有设计决定; 用户已确认此类 issue 不需要治理设计 (2026-11-02), 按 `spec-readiness` Skill 的 Exception workflow 记录 `not-applicable`.
- 实施记录 (2026-11-02): 体积预算内, 非测试代码净增 0 行. 未使用 Reviewer 或 subagent. 提交时走实施提交工作流 (改动为测试 fixture 和 `.gitignore`, 不属于非实施分类); `Status` 由 Main Agent 在暂存候选前改为 `completed`. 一次性改写脚本和基线副本放在 `.tmp/` 下, 已删除.
- 提交审核第 1 轮: requirements-reviewer `No problems.`; code-standards-reviewer 报告本条实施记录对 `Status` 的描述与实际不符, 已更正.
