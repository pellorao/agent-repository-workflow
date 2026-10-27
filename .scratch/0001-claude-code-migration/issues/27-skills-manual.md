# Skill 用户手册与 README 走机械提交

Status: ready-for-agent

## What to build

用户发现 (2026-10-28): README "附带技能" 一节缺少 ticket 07 从规则改成的 9 个 Skill (`arw-commands`, `code-maps`, `issue-tracking`, `reviewer-launch`, `rule-and-design-changes`, `spec-readiness`, `test-performance-optimization`, `test-value-cleanup`, `validation`), 也没有说明哪些 Skill 不会自动触发, 需要用户显式点名. 其他用户可能不知道这些 Skill 的存在. 用户决定:

- 单开用户手册 `docs/manuals/skills.md` 和 `docs/manuals/skills.zh-CN.md`. 上游 Skill 与 ARW 自定义 Skill 分成两个大章节 (用户 2026-10-28); 上游 Skill 以 `upstream/sources/*/source.json` 的映射和 `adoptions.md` 为准, 章节写明来源仓库. 每个大章节内按用途分组列出 `distribution/skills/` 中全部 Skill, 并标明是 Agent 在对应任务前自动使用, 还是不会自动触发 (`disable-model-invocation: true`) 需要显式点名. 详略 (用户 2026-10-28): 上游 Skill 从简, 每个一句话说明用途并链接上游介绍文档; ARW 自定义 Skill 必须详细, 每个写明用途, 何时触发或何时该点名, 主要步骤和产出 (记录, 报告, 提交等), 相关的 `arw` 命令和关联 Skill, 让用户不读 `SKILL.md` 也能判断何时用和会发生什么. 不复制 Skill 的完整合同.
- 根 `README.md` 和 `README.zh-CN.md` 的 "附带技能" 一节缩短为简介加手册链接, 并按读者文档规范更新路由.
- 根 `README*.md` 和 `docs/**` 一样走非实施机械提交: 修改 `arw commit-audit verify --non-implementation` 的路径判定, `commit` Skill 及其投影和分发副本, 长期规范的对应条款; 有测试覆盖.
- 初稿 `.tmp/readme-skills.patch` (在 README 补两行列表) 只作参考, 改为手册后不再需要.

预估净增: 手册中英文各约 200 行 (自定义 Skill 每个约 8 到 12 行), README 净减约 10 行, 代码和测试约 10 行, 合计约 +400.

## Spec Requirement

Governing requirements:

- `docs/specs/arw-reader-documentation/spec.md`
- `docs/specs/agent-repository-workflow/spec.md#commit-audit`

## Acceptance criteria

- [ ] `docs/manuals/skills.md` 与 `skills.zh-CN.md` 覆盖 `distribution/skills/` 中全部 Skill, 上游与自定义分两个大章节, 标明自动使用或需显式点名; 有测试或检查保证新增 Skill 时手册不遗漏.
- [ ] README 两个版本的 "附带技能" 链接到手册, 读者文档路由一致.
- [ ] 只改根 `README*.md` 的暂存候选可以通过 `arw commit-audit verify --non-implementation`; 有测试覆盖.
- [ ] 全量测试, 投影与分发检查, `arw text check` 通过.

issue 17 同改 `lib/commit-audit/`, 合入后再开工.

## Blocked by

- issue:0001:17
