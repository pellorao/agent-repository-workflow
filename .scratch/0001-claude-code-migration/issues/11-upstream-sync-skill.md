# Upstream Sync 与 Platform Standards 改为不自动触发的 Skill

Status: ready-for-human

## What to build

Upstream Sync 和 Platform Standards 改为源码仓库专用, 不自动触发的 Skill, 仍由 Agent 执行, 目标是人工审核后采用上游 Skill 新版本. 实现压缩到达成目标所需的最小程度.

预估改动: 大幅净减.

## Spec Requirement

Governing requirements:

- `.scratch/0001-claude-code-migration/spec.md#rule-structure-and-context-budget`
- `.scratch/0001-claude-code-migration/spec.md#code-reduction`

## Acceptance criteria

- [x] Skill 不自动触发, 两个平台的元数据都已设置.
- [ ] 按 Skill 执行能完成一次同步审核.
- [x] 相关代码, 测试和文档大幅净减, 测试通过.

## Blocked by

- issue:0001:03
- issue:0001:07

## Comments

- 新建源码仓库专用 Skill `.agents/skills/upstream-sync/` 和 `.agents/skills/platform-standards/` (后者由 `docs/agents/platform-standards.md` 移入并压缩): Claude `disable-model-invocation: true`, Codex `agents/openai.yaml` 中 `allow_implicit_invocation: false`; 加入 Workflow Distribution 同步的 `sourceOnlyRoots`. `AGENTS.md.bak` 索引改为: Upstream Sync 只在显式调用 `$upstream-sync` 时进行; 研究或修改平台标准前读取 `platform-standards` Skill.
- Upstream Sync 改为 Agent 清单加一个短脚本 `scripts/upstream-sync.mjs <source> <commit>` (约 70 行): 用 Git 取得 Base (固定提交) 与 Theirs, 列出范围内每个上游变化 (含改名, 改出或改入范围按删除或新增) 和 Ours 状态 (`ours=base`, `ours=theirs`, `ours-changed`, `ours-missing`), 快照写到 `.tmp/upstream-sync/`, 本地定制文件用 `git merge-file` 生成带冲突标记的合并起点. 维护者逐批批准, 采用结果记录为 `source.json` 的新 `commit`, `adoptions.md` 一节和普通 Git 提交.
- `source.json` 简化为 `url`, `commit`, `map` (前缀或精确路径映射, 同时充当范围) 和 `exclude`; 删除 `platform`, glob 范围和两个引用审核列表.
- 删除: `lib/upstream-sync/upstream-sync.mjs` (3607 行) 与两个测试文件 (3568 行), 旧 CLI, 三份 `docs/agents/upstream-sync*.md`, Upstream Sync 长期规格, 旧 Sync Record (保留在 Git 历史, `adoptions.md` 有指针), `.gitignore` 中的工作区条目, Platform Adapter 中只供旧引擎使用的 `toCanonicalSkills` 和 `analyzeSkillReferences` 的 `sourcePlatform` 参数及其 3 个测试, `skill-reference-review.mjs` 中只供旧引擎使用的 `skillReferenceReviewHashes` 及其直接测试.
- 放弃的机制: 工作区状态机, Review Revision, Approval Attestation, 恢复授权, `HEAD` 检查点, 自动的来源平台引用转换和 `reviewEditor` 引用审核. 引用改写 (`/name`, "Call the Skill tool with ..." 改为 `$name`) 由 Agent 在合并时按清单完成, 因为上游已出现无法机械转换的写法.
- ADR 0011 加状态说明 (引擎部分被取代; 源码专用, 人工三方审核, 固定提交和范围继续有效); 0028 说明分批审核继续有效; 0014, 0015, 0017, 0026 中相关句子加指针. 开发手册, 开发与总长期规格的引用已改.
- "按 Skill 执行能完成一次同步审核": 已试运行三方视图: 以固定提交 `6acc160` 为 Base, 上游当前 `5beb35b` 为 Theirs, 脚本列出 48 个范围内变化 (13 个 `ours=base` 修改, 1 个本地未改的上游删除, 7 个新文件, 1 个改名 `CONTEXT-FORMAT.md` -> `GLOSSARY-FORMAT.md` 并带本地定制合并, 其余为本地有定制, 合并冲突 0 到 10 块); 目标等于固定提交时输出为空并退出 0. 完整审核需要维护者逐批批准, 本次未进行, 因此不勾选; 维护者调用 `$upstream-sync` 完成一次采用后勾选.
- 遗留: `lib/release/reviewer-capability-conformance.mjs` 的指令分类表仍列出已删除的 `docs/agents/upstream-sync.md` 和 `docs/agents/platform-standards.md` (仅为字符串, 不读取文件, 测试通过), 留给 ticket 10 重写该文件时删除.
- 独立审查 (opus) 发现并已修复: 无变化时脚本崩溃; 上游改名被拆成删除加新增会丢本地定制 (改用 `-M`); 上游新文件与 ARW 自有 Skill 重名时的处理; 发布前同步命令写法; 手册 `lib/` 表格行; ADR 0017, 0022, 0028 中 "继续有效" 的句子加指针; 删除无调用方的 `skillReferenceReviewHashes`. 未处理: 同一 Skill 在两个映射类别间移动会被视为删除 (上游历史未出现).
