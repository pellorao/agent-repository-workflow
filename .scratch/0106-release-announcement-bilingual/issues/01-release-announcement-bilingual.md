# 发布公告改为中英双语

Status: completed

## What to build

`release` Skill 的 `references/publication.md` 与发布 spec 现在要求公告 title 和正文只用中文, 而 0.5.2 与 0.5.3 的实际公告都是英文在前, 简体中文在后的双语. 把规则改成与实际一致, 格式以 0.5.3 Release 为准:

- 正文顶部是互跳链接 `[English](#english) | [简体中文](#简体中文)`, 然后先 `## English`, 后 `## 简体中文`, 两部分内容一致.
- title 使用英文.
- 公告的其余条目规则不变.

改动文件: `.agents/skills/release/references/publication.md` 及其投影 `.claude/skills/release/references/publication.md`, `docs/specs/agent-repository-workflow-release/spec.md` 第 22 行 (同样写着 "title 和正文使用中文"). 已检查仓库内其他文档, 没有别处要求公告只用中文.

预估净增: 约 +90 字符 (文档).

## Acceptance criteria

- [x] `publication.md` 及其投影写明公告为英文在前, 简体中文在后的双语, 含互跳链接, title 为英文, 其余条目规则不变.
- [x] 发布 spec 的公告语言描述与之一致.
- [x] 仓库内不再有 "公告只用中文" 的表述.
- [x] 分发, 投影, 文本检查通过.

## Blocked by

- None - can start immediately

## Validation

- 仅改文档, 未运行 `pnpm test`/`pnpm typecheck` (无代码改动). `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `node arw.mjs text check`, `node arw.mjs terms check`, `git diff --check` 通过.
- `grep` 仓库 (docs, `.agents/skills`, README, CONTEXT) 无其他 "公告只用中文" 表述.

## Comments

- 就绪记录为 `not-applicable` 例外 (无设计决定的单 issue, 用户 2026-11-02 在 projects AGENTS 中对此类 issue 的常设确认), 在修改实现文件前生成.
- Agent 规则与设计文档的改动由 Main Agent 确认等同用户确认 (Source Checkout Baseline 例外).
- 体积: 净增约 +111 字符 (publication.md +94, spec +17), 超出预估约 21 字符. 原因是 issue 规定的互跳链接, 英文 title 与两段标题无法再删.
- 台账: docs/specs/agent-repository-workflow-release/spec.md:22 冲突裁决 要求符合审核要求 spec 与 publication.md 语言描述一致, Code Standards 第 1 轮要求缩短; 按 issue 验收保留一致的完整描述, 超出的 17 字符已在上条记录.
