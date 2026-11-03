# ADR 中本地验证输入的措辞改为 fixture 压缩包

Status: completed

## What to build

`docs/adr/0031-use-github-and-local-validation-sources.md` 第二段和 `docs/adr/0018-use-bounded-mechanical-trust-for-initial-arw-security.md` 的对应段落仍按旧方案 (仓库外源码目录, 独立外部 JSON 保存目录位置, 准备时建立临时 Git 基线) 描述发布验证输入. 现状见 `docs/adr/0039-keep-arw-local-settings-in-a-repository-local-file.md` 和 `.agents/skills/release/references/`: 输入是维护者在仓库外保存的 Git 跟踪 fixture 压缩包, 目录由 `.arw.local.json` 的 `release.fixturesDirectory` 记录, 验证只解压到临时目录使用.

- ADR 0031 该段改写为现状 (保留 "不要求原项目 Git 历史或固定原提交", "继续执行真实 Git 工作流检查", "不进入版本管理或发布证据", 对 0039 的引用; 删去源码目录, 外部 JSON, 临时 Git 基线和 bundle 的叙述).
- ADR 0018 对应段落同步, 并保持 "不成为原项目版本或来源信任权威" 的结论.
- `.agents/skills/release/references/fixtures.md` 第 3 行 "VM 配置 JSON 的 `fixturesDirectory`" 改为 ARW 发布配置的 `fixturesDirectory`.
- 全仓 grep 未发现其他引用旧说法的已跟踪文件 (`release-validation-sources.json` 只在 `.scratch/0047-*` 的工作记录中, 不改).

体积预算: 文档净增不超过 0 字符 (按 `wc -m` 三个文件合计).

预期验证: `node arw.mjs text check`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `git diff --check`, `node arw.mjs language inspect` 改动的文档.

## Acceptance criteria

- [x] 0031 与 0018 不再提 "仓库外源码目录", "独立外部 JSON", "临时 Git 基线", "临时提交", 而按 fixture 压缩包和 `release.fixturesDirectory` 陈述 (审核核对文字).
- [x] `fixtures.md` 与 `vm.md` 对 `fixturesDirectory` 的归属表述一致.
- [x] 上述验证命令退出码 0.

## Blocked by

- None - can start immediately

## Validation

- `node arw.mjs text check`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check` (先运行投影脚本更新 `.claude/skills/release/references/fixtures.md`), `node arw.mjs terms check --strict`, `git diff --check` 全部通过; `node arw.mjs language inspect` 三份文档均以中文为主 (84.1% 至 90.2%).
- 体积 (`wc -m`): 0031 1019 到 1020, 0018 1837 到 1838, `fixtures.md` 953 到 950, 合计净减 1 字符, 在预算内.
- 全仓 grep `release-validation-sources`, 外部 JSON, 源码目录相关措辞: 已跟踪文件中只有上述三处, `.scratch/0047-vm-config-split/spec.md` 的工作记录不改.
- Spec Readiness: 按用户 2026-11-02 的常设确认记录 `not-applicable` 例外 (`arw spec-readiness verify` 通过).
- 只删减与合并的自查: 改动本身是改写和删除旧叙述, 没有新增段落.

## Comments

- ADR 0031 与 0018 的 "临时 Git 基线 / 临时提交" 叙述随旧方案删除, 改为 "压缩包自带的提交不证明原项目身份".
- 台账: docs/adr/0018-use-bounded-mechanical-trust-for-initial-arw-security.md:11 冲突裁决 0018 经链接指向 0031, 键名只在 0031 陈述, 按单一权威来源满足验收第 1 条
