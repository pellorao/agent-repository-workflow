# 仓库根 .gitattributes 与发布检查的 CRLF 源码检出轮

Status: completed

## What to build

Windows 上 Git 默认 `core.autocrlf=true` 检出 ARW 源码后, 分发文件变为 CRLF, `node install.mjs` 因 `release-manifest.json is not canonical JSON.` 直接失败 (`lib/installation/installation-payload.mjs` 的 `readCanonicalJson` 要求字节一致). 发布检查里 guest 的 ARW 源码固定用 `core.autocrlf=false` 克隆, 从未发现这一点. 用户 2026-11-06 在 decide `ARW/crlfcheck-d` 选定方案 A: 在仓库根加 `.gitattributes`, 并让发布检查覆盖这条路径. 现有 1294 个跟踪文件都是 LF. README 的 `-c core.autocrlf=false` 说明保留不改 (旧检出仍需要), 不改用户文档.

1. 仓库根新增 `.gitattributes`, 内容 `* text=auto eol=lf`.
2. `scripts/release-guest-check.mjs`: 仅 Windows, 在最后一次卸载及 "Installation 目录不剩文件" 之后, 嵌套重跑之前, 加一轮: 把候选 checkout 以 `core.autocrlf=true` 克隆到临时目录并确认分发文件 (`release-manifest.json`, `distribution/config.json`) 仍为 LF; 从这份检出运行 `node install.mjs --non-interactive --register-path true` (源码安装); 新建 Git 仓库运行 `workflow init` 与 `verify`; 再检出一份 agent-assisted fixture (同现有 fixture 步骤的标签选择) 运行 `workflow update` 与 `verify`; 最后卸载 (删除配置) 并确认 `arw` 不再解析. 现有 fixture 克隆参数抽成共用的小函数.
3. `docs/specs/agent-repository-workflow-release/spec.md` 的 `Validation coverage` 节 `Windows only` 表加这一情形; `.agents/skills/release/SKILL.md` 与 `references/vm.md` 的相关说明同步.
4. 先红后绿: 同一份新脚本分别叠在不含和含 `.gitattributes` 的候选上, 在 `win11` 上运行 guest 检查; 不含的候选失败于 "分发文件为 LF" (分发文件为 CRLF; 上一段已观察到在其后的 "从 CRLF 源码检出安装" 因 `release-manifest.json is not canonical JSON.` 失败), 含的候选通过. 红没出来时停止, 不硬改.

预算: 非测试代码净增不超过 25 行 (`.gitattributes` 1 行, guest 脚本约 20 行).

预期验证: `win11` 上红绿两次 guest 检查; `pnpm typecheck`, `pnpm test`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `node --check scripts/release-guest-check.mjs`, `node arw.mjs text check`, `node arw.mjs terms check --include .scratch/0097-crlf-source-checkout-check/`, `git diff --check`.

## Acceptance criteria

- [x] 仓库根有 `.gitattributes` (`* text=auto eol=lf`), `core.autocrlf=true` 检出后分发文件为 LF.
- [x] guest 检查新增 Windows 轮: 不含 `.gitattributes` 的候选失败, 含的候选通过.
- [x] 发布 spec 与 `release` Skill 说明同步.
- [x] 预期验证全部通过.

## Blocked by

- None - can start immediately

## Comments

用户 2026-11-06 已在 decide `ARW/crlfcheck-d` 选定方案 A; Main 判定无剩余设计决定, 就绪记录按 Exception workflow 记 `not-applicable`, 依据用户 2026-11-02 的常设确认 (总层 AGENTS.md ARW 自主工作方式). 授权任务: `.tasks/ARW/crlfcheck.md`.

## Validation

- win11 guest 检查 (`--previous` 取 0.5.1 的 commit `6a53534`, 候选为同一份新脚本叠在当前 HEAD `2c242bb` 上): 不含 `.gitattributes` 的候选 `Windows 11: FAIL`, 失败于 "分发文件为 LF" (`release-manifest.json` 与 `distribution/config.json` 含 CR), 其前所有原有步骤通过; 含 `.gitattributes` 的候选 `Windows 11: PASS` (`PASS win32 node 24.18.0 0.5.2`), 新轮全部步骤 ok (CRLF 克隆后分发文件为 LF, 源码安装, init, verify, fixture update, verify, 卸载, arw 不再解析), 嵌套重跑通过. 上一段已在无 `.gitattributes` 的候选上观察到源码安装失败.
- `pnpm typecheck`, `pnpm test` (920 项全部通过), `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `node --check scripts/release-guest-check.mjs`, `node arw.mjs text check`, `node arw.mjs terms check --include .scratch/0097-crlf-source-checkout-check/`, `git diff --check` 均通过. `.gitattributes` 不在发布清单, 分发, `text check` 或测试中产生影响 (1294 个跟踪文件原本全是 LF).
- Spec Readiness 例外 `not-applicable` 已提升并核对. 提交审核第 1 轮: Code Standards 报告 `No problems.`; 要求符合报告两项记录问题 (Validation 为空, 第 4 项失败步骤与第 2 项顺序矛盾), 已补记录并统一为 "分发文件为 LF". 第 2 轮要求符合审核报告 `No problems.`, Code Standards 第 1 轮结论沿用 (代码未变). `commit-audit verify` 取得空错误列表, `spec-readiness verify --subject-only` 通过.
- 第 1 轮 Commit Audit 摘要: `code: +22 lines (files: 2)`, `documents: +748 characters (files: 5)`, `tests: 0 lines (files: 0)`, `next ADR number: 0041`. 预算 25 行, 实际代码净增 22 行.
