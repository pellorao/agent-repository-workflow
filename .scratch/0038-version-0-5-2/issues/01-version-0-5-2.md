# 产品版本推进到 0.5.2

Status: completed

## What to build

0.5.1 已发布并通过公开 Bootstrap 验证. 按 `release` Skill 第 5 节, 把根 `package.json` 的 `version` 从 `0.5.1` 推进到下一个开发版本 `0.5.2`, 运行 `node scripts/generate-install-arw.mjs`, 之后源码安装的 `-pre` 身份为 `0.5.2-pre`.

预估净增: 0 行 (一行替换).

## Acceptance criteria

- [x] 根 `package.json` 的 `version` 为 `0.5.2`, 其余内容不变.
- [x] `node scripts/generate-install-arw.mjs` 已运行, `--check` 通过.
- [x] 全量测试, 类型检查, 分发检查, `arw text check` 通过.

## Blocked by

- None - can start immediately

## Validation

- `pnpm test` 839 通过 / 0 失败; `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `node arw.mjs text check`, `git diff --check` 通过.
- `node scripts/generate-install-arw.mjs` 运行后 `scripts/install-arw.mjs` 没有变化 (引导脚本不含版本号).
- 净增: 代码 +1 / -1 (净 0).

- 发布验证 (候选 `18ac1565b70eeea35a1226822a9c5c921cf92c56`, 均为 0.5.1 升级到 0.5.2):
  - `PASS win32 node 24.18.0 0.5.2 18ac1565b70eeea35a1226822a9c5c921cf92c56`
  - `PASS linux node 24.18.0 0.5.2 18ac1565b70eeea35a1226822a9c5c921cf92c56` (Ubuntu)
  - `PASS linux node 24.17.0 0.5.2 18ac1565b70eeea35a1226822a9c5c921cf92c56` (Alpine)
- 本地检查: `pnpm typecheck`, `pnpm test` (920 通过), 分发检查, `generate-install-arw --check`, `arw text check`, `arw terms check --strict`, `arw language inspect distribution` 通过 (仅外部拷贝的 `codebase-design` 两份文档中文占比约 71% 至 73%, 属原样拷贝, 不改).
- Fixture: plain 按 `references/fixtures.md` 的参数 `workflow init` 后 `workflow verify` 通过; agent-assisted (`arw-0.5.1`) 由 guest 检查覆盖.
- Agent CLI 检查: 隔离 home 安装候选, `workflow init` 后 `claude -p` 与 `codex exec` 的回答都含 `implement` 与 `Agent Repository Workflow`.
- 发布: tag `0.5.2` 与 main 指向候选, GitHub Release 含 `arw.tar.gz`; 公开 Bootstrap (指定版本与最新) 安装后 `arw --version` 均输出 `0.5.2`.

## Comments

- 就绪记录为 `not-applicable` 例外 (无设计决定的单 issue, 用户 2026-11-02 确认), 在修改 `package.json` 前生成.
- 第 9 步 (交接冒烟): skip (维护者选择, 2026-11-06).
- 第 10 步 (Reviewer 能力漂移检查): skip (维护者选择, 2026-11-06).
- 发布验证中 Windows 首跑 (三台并行) 失败于 "Bootstrap 安装候选": `EPERM: operation not permitted, rename '...\.manifest.json.arw-tmp-...' -> '...\manifest.json'`, 超出 `renameReplacing` 内置约 3 秒的重试, 其后各文件报 `Manual cleanup required`. 原始输出存于会话工作区 `release/vm-Windows11.fail1.log`. 判断为环境抖动 (Windows 文件被杀毒或索引短暂占用, 三台 VM 并行加重负载), 依据: 同一候选与同一命令单独重跑 PASS, 代码无改动, Ubuntu 与 Alpine 首跑即 PASS. 未改代码.
- 发布后 fixture 更新 (2026-11-06): `agent-assisted.tgz` 已按 `references/fixtures.md` 更新到 0.5.2, fixture 内提交 `ae1423f` 加 tag `arw-0.5.2`, `workflow update` 与 `verify` 通过; `plain.tgz` 未改.
