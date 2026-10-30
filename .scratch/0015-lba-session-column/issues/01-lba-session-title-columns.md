# lba 会话 ID 与标题分列

Status: completed

## What to build

按用户 2026-10-30 的建议, 实现 [spec:0015](../spec.md): `lba` 列改为 `Status`, `Role`, `Elapsed`, `Session`, `Title`, 删除 `formatTextTable` 的后缀支持.

同步更新 `docs/specs/agent-repository-workflow/spec.md` Background Agent listing 中列清单 (`Status`, `Role`, `Main session`, `Elapsed`), "`Main session` 始终显示完整 session ID..." 与 "标题位置以灰色文本显示 `N/A`..." 两句, 以及 ARW Artifact operations 截断规则中只为 `lba` 后缀存在的表述; 其他提及 `lba` 列的 README, 手册和 Skill 句子. 只改与本行为相关的句子.

验证: `pnpm test`, `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `node arw.mjs text check`, `node arw.mjs terms check --include .scratch/0015-lba-session-column/`, `git diff --check`. 测试覆盖: `lba` 新列顺序与内容, 标题超长时只截断 `Title` 且 session ID 完整, `--full` 全文, 标题未知显示 `N/A`; `formatTextTable` 去掉后缀后既有截断测试仍成立. 新增或语义修改测试后测量回调耗时.

预估非测试代码净增约 -5 行; 文档净增约 0 字符.

## Acceptance criteria

- [x] `lba` 输出 `Status`, `Role`, `Elapsed`, `Session`, `Title` 五列, `Session` 完整, 只有 `Title` 默认截断, `--full` 不截断. 观察: 测试.
- [x] `formatTextTable` 与 `listTableOptions` 不再有后缀参数. 观察: 代码差异.
- [x] 长期规格与相关文档记录新列. 观察: 文档差异.
- [x] 完整验证命令通过. 观察: Validation 的实际命令结果.

## Blocked by

- None - can start immediately

## Validation

- 代码: `lib/background-agent/presentation.mjs` 输出 `Status`, `Role`, `Elapsed`, `Session`, `Title`, `Title` 为可截断列; `lib/common/text-table.mjs` 删除 `suffixes` 与 `listTableOptions` 的后缀参数. 非测试代码净增 0 行 (预估 -5).
- 测试: `tests/background-agent/presentation.test.mjs` 改为五列并新增默认只截断 `Title`, `Session` 完整, `full` 全文的用例; `tests/common/text-table.test.mjs` 去掉后缀用例; `tests/arw-entry.test.mjs` 更新表头断言. 改动回调最慢约 4.9 毫秒.
- 文档: 总长期规格截断规则去掉后缀宽度, Background Agent listing 的列清单, session ID 与 `N/A` 两句. README 与 `arw-commands` Skill 的 "名称列 (`Title`, `lba` 为会话标题)" 在新列下仍准确, 未改.
- `pnpm test`: 810 个测试全部通过; `pnpm typecheck`, 三个生产检查脚本, `node arw.mjs text check`, 本 effort 的 terms check 与 `git diff --check` 通过.

## Comments

- Spec Readiness 共 3 轮: 补 Testing Decisions, `listTableOptions` 与 `width` 缺省的映射, 卸载确认表不设自动测试的理由.
- Commit Audit 第 1 轮: 总长期规格截断规则的命令清单补上 `background-agents` (既有缺口), 使 `lba` 的 `Title` 截断引用成立.
