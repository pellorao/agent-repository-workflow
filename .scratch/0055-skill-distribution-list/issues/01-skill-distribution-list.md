# Skill 分发登记

Status: completed

## What to build

按 `.scratch/0055-skill-distribution-list/spec.md` 的 Behavior, Testing 与 Module Design 节:

- `distribution/config.json` 增加 `distributedSkills` 与 `sourceOnlySkills` (初始名单见 spec: `sourceOnlySkills` 为 `reviewer-capability`, `release`, `upstream-sync`, `platform-standards`, `unattended-run`, 其余 `.agents/skills/` 下的 Skill 全部进 `distributedSkills`).
- `lib/workflow-distribution/workflow-distribution.mjs`: `validateDistributionConfig` 改为恰含三个键 (键集合错误沿用 `distribution-config-invalid`) 并检查两个列表 (`skill-lists-invalid`: 非数组, 非法身份, 重复, `distributedSkills` 为空, 两列表相交); 新增并导出纯函数 `skillRegistrationDiagnostics`.
- `lib/workflow-distribution/workflow-distribution-sync.mjs`: 删除硬编码的 `sourceOnlyRoots`, 先读配置, 再调用新导出的 `checkSkillRegistration({distributionConfig, filesystem})` (递归列出 `.agents/skills`, Skill 身份是含至少一个文件的直接子目录名; 符号链接与直接位于其下的非目录条目阻断), 有诊断则 `blocked`, 只复制 `distributedSkills`.
- `scripts/check-workflow-distribution.mjs`: 构建与自包含检查成功后用 `createScopedFilesystem({root: sourceRoot})` 调用同一个 `checkSkillRegistration`, 新增可选 `sourceRoot` (默认源码仓库根); 任何非成功结果映射为 `{diagnostics, status: 'failed'}`.
- `.agents/skills/upstream-sync/SKILL.md`: 询问是否采用上游新 Skill 时一并询问是否分发并登记到 `distribution/config.json` (一句话); 运行 `node scripts/project-claude-skills.mjs` 更新投影, `node scripts/sync-workflow-distribution.mjs` 与 `node scripts/generate-install-arw.mjs` 更新生成物 (`upstream-sync` 是源码专有, `distribution/` 应无差异).
- `docs/specs/agent-repository-workflow-development/spec.md` 的配置节, 源码限定段, `Entry point and lifecycle` 节的失败列表与来源表的阻断一行, 以及 `Module Design` 节两个 Module 的责任, `docs/adr/0026-...` 的取代说明, 新 ADR `docs/adr/0040-register-skill-distribution-in-config.md`; 手册中没有对分发范围的描述则不改.
- 测试按 spec 的 Testing 节更新 (全部用假文件系统和临时目录夹具, 不加真实进程测试).

体积预算: 计数口径是非测试代码 (`lib/`, `scripts/` 下 `.mjs`) 的 `git diff --numstat` 新增减删除, 含被替换的旧代码, 不计 JSON 配置, 测试与文档; 净增不超过 +30 行.

预期验证: `node --test tests/workflow-distribution/`; 在真实仓库运行 `node scripts/check-workflow-distribution.mjs` 通过, 同步后 `distribution/` 无差异; 删去或增加一个名单项时检查报相应诊断 (由测试观察); `pnpm typecheck`, `pnpm test`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `node arw.mjs text check`, `git diff --check`.

## Acceptance criteria

- [x] `distribution/config.json` 含两个列表且初始名单与 spec 一致; 同步后 `distribution/skills/` 内容与改动前相同 (`git status` 核对).
- [x] 硬编码的 `sourceOnlyRoots` 已删除; 同步只复制 `distributedSkills` 中的 Skill (同步测试观察).
- [x] 缺少列表键返回 `distribution-config-invalid`; 列表格式非法, 空 `distributedSkills`, 两列表相交返回 `skill-lists-invalid`; 未登记的 Skill (含非法目录名) 返回 `skill-unregistered`; 名单含不存在的名字返回 `skill-registration-stale`; 同步在删除之前 `blocked` (测试观察).
- [x] `check-workflow-distribution.mjs` 与同步调用同一个 `checkSkillRegistration`.
- [x] `upstream-sync` Skill 含询问是否分发并登记的一句话; `.claude/skills/` 投影一致.
- [x] 长期规格, ADR 0040 与 ADR 0026 的取代说明已更新; 上述验证命令全部退出码 0; 非测试代码净增在预算内或已在 `## Comments` 说明.

## Blocked by

None.

## Validation

- `pnpm typecheck`, `pnpm test` (867 通过 / 0 失败), `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `node arw.mjs text check`, `node arw.mjs terms check --strict`, `git diff --check` 退出码均为 0.
- 初始名单: `node scripts/sync-workflow-distribution.mjs` 在真实仓库成功, 运行后 `distribution/` 只有 `config.json` 变化, `distribution/skills/` 无差异.
- 测试观察: `tests/workflow-distribution/` 新增用例覆盖缺少列表键, 列表格式非法, 空 `distributedSkills`, 两列表相交, 未登记 (含非法目录名), 过期名字, 直接位于 `.agents/skills` 下的普通文件, 符号链接, 空目录不要求登记, `.agents/skills` 缺失, 同步在删除前阻断 (旧 `obsolete` 仍在), 生产检查对缺失根目录映射为 `failed`. `tests/repository-workflow/workflow.test.mjs` 夹具补两个列表.
- 体积: 非测试代码 (`lib/`, `scripts/`) `git diff --cached --numstat` 新增减删除净增 +23 (预算 +30), 提交审核第 1 轮删去 `loadSkillSourcePayload` 中被登记检查覆盖的不可达分支后重算.
- 只删减与合并的自查: 压缩了 `skillRegistrationDiagnostics` 的重复结构; 登记检查与同步复制共用一份 Skill 身份推导的合并不可行 (一个只列目录, 一个要读文件字节), 未再删减.

## Comments

- 提交审核第 1 轮 (5 个问题, 均未改 subject): 删除 `loadSkillSourcePayload` 中被 `checkSkillRegistration` 覆盖而不可达的身份检查, `skill-source-empty` 与 `blocked` 分支 (`skill-source-empty` 因此无引用, 测试与文档均无引用, 无需同步), 非测试净增由 +48 降为 +23, 在预算内, 原超出预算的说明作废; 生产检查测试名改为如实描述; 增加缺 `sourceOnlySkills` 的配置用例; 同步 "删除前阻断" 用例加入真实符号链接情形 (平台不支持创建时跳过) 并断言旧 `obsolete` 未被删; ADR 0026 与 0040 引用的原文改为 0026 的实际文字. 全部验证命令重跑退出码 0 (`pnpm test` 867 通过).
