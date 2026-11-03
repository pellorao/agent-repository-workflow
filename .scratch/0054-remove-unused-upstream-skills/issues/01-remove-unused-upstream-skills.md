# 删除不用的上游 Skill

Status: completed

## What to build

删除三个不用的上游 Skill: `handoff`, `resolving-merge-conflicts`, `triage` (用户 2026-11-03 审定, 其余上游 Skill 全部保留). 删除 `.agents/skills/` 下对应目录, 用 `node scripts/project-claude-skills.mjs`, `node scripts/sync-workflow-distribution.mjs`, `node scripts/generate-install-arw.mjs` 重新生成 `.claude/skills/` 与 `distribution/` 副本; 把三个上游路径 (`skills/engineering/triage/`, `skills/engineering/resolving-merge-conflicts/`, `skills/productivity/handoff/`) 加入 `upstream/sources/mattpocock-skills/source.json` 的 `exclude`, 防止下次同步带回; 修正 `docs/manuals/skills.md` 与 `docs/manuals/skills.zh-CN.md` 的 Skill 列表, 数量 23 改为 20, 以及仅因 `handoff` 而得名的小节标题. 在 `upstream/sources/mattpocock-skills/adoptions.md` 末尾追加一节记录这次拒绝及原因 (不改已有节); 已完成的 effort 不改. 删除理由: 三者在仓库中都没有被规则, 代码或其他 Skill 引用; `handoff` 的交接作用已由 issue, 台账, 就绪记录等持久记录和平台自带的上下文压缩覆盖; `resolving-merge-conflicts` 针对并行分支合并, ARW 的工单在主工作区串行进行; `triage` 自带的分诊状态机与 ARW issue 的 Status 和分流标签不一致.

体积预算: 以删除为主, 文档净减少 (按字符计); 不新增代码.

## Acceptance criteria

- [x] 三个 Skill 在 `.agents/skills/`, `.claude/skills/`, `distribution/skills/` 中均已不存在, 生成物由脚本生成.
- [x] `source.json` 的 `exclude` 含三个上游路径.
- [x] 手册列表与数量为 20, 仓库内无对这三个 Skill 的有效引用.
- [x] 验证命令退出码 0.

## Blocked by

- None - can start immediately

## Validation

- `pnpm typecheck`, `pnpm test`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `node arw.mjs text check`, `git diff --check` 退出码均为 0.
- 上游路径依据: 手册中三项的上游链接分别指向 `skills/engineering/triage/`, `skills/engineering/resolving-merge-conflicts/`, `skills/productivity/handoff/`.
- 体积: 删除 3 个 Skill 目录 (含 distribution 与 .claude 副本), 两份手册各 2 行新增, 5 行删除, 合计净减 6 行; `adoptions.md` 新增一节; 无新增代码.
- Spec Readiness: 记录 `not-applicable` 例外 (用户 2026-11-02 常设确认).
- 只删减与合并的自查: 本 issue 只含删除与引用修正, 无可再删减内容.

## Comments

- 提交审核第 1 轮: 去掉指向本机任务文件的引用, 删除理由写入正文; 按 `upstream-sync` Skill 记录要求在 `adoptions.md` 追加拒绝记录; 修正 Validation 行数. 因 `## What to build` 改动, 重新记录 `not-applicable`.
