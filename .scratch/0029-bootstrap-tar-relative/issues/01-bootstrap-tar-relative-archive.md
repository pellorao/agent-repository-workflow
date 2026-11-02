# Bootstrap 以相对归档名在下载目录运行 tar

Status: completed

## What to build

问题: `lib/installation/bootstrap.mjs` 的 `extractArchive` 把绝对路径 (Windows 上形如 `C:\...\arw.tar.gz`) 传给 `tar -xzf`; Git for Windows 等环境下的 GNU tar 把 `C:` 当作远程主机, 解压失败.

改动: 以下载目录为 `cwd` 运行 `tar -xzf arw.tar.gz`, 去掉 `-C` 和绝对归档路径; 用 `node scripts/generate-install-arw.mjs` 更新生成物 `scripts/install-arw.mjs`.

体积预算 (非测试代码行): 净增 -1 行; 上限 0.

预期验证: 新测试在 PATH 放假 `tar` (记录 `$PWD` 与参数), 断言在下载目录以 `-xzf arw.tar.gz` 运行; 已有真实归档解压测试继续通过; `node scripts/generate-install-arw.mjs --check` 通过. 真实 Windows tar 由发布验证批次 B 覆盖. 边界情况: 无.

## Acceptance criteria

- [x] `extractArchive` 在下载目录以相对归档名运行 tar, 生成物同步.
- [x] 新测试断言 tar 的工作目录与参数, 不依赖真实 Windows.

## Blocked by

- None - can start immediately

## Validation

- 验收条件 1: `git diff` 显示 `lib/installation/bootstrap.mjs` 净减 1 行 (预算内), `scripts/install-arw.mjs` 由生成脚本更新, `node scripts/generate-install-arw.mjs --check` 通过.
- 验收条件 2: `tests/installation/bootstrap.test.mjs` 新测试 "bootstrap runs tar inside the download directory with a relative archive name" 通过, 约 3 ms; 既有真实归档解压测试通过.
- 全量: `pnpm test` 827 通过, `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `arw text check`, `arw terms check --include .scratch/0029-bootstrap-tar-relative/` 均通过. 就绪记录为 `not-applicable` 例外 (用户 2026-11-02 确认).

## Comments

- 就绪记录 (`not-applicable` 例外) 在实现改动之后才生成, 与 "首次修改实现文件前取得就绪结果" 的顺序不符. 维护者 2026-11-02 已追认这一偏离.
- 第 1 轮提交审核: 新测试与 D1 测试重复了 "前置假命令到 PATH 并恢复" 的脚手架. 已抽成 `tests/helpers/process.mjs` 的 `installFakeCommand`, 两处改用它; `tests/installation/*.test.mjs` 与 `tests/helpers/*.test.mjs` 112 个通过, `pnpm typecheck` 通过.
