# 产品版本改为 0.5.1

Status: completed

## What to build

维护者 2026-11-02 授权发布 0.5.1 修复版 (0.5.0 发布验证遗漏的 Windows 与升级缺陷). 根 `package.json` 的 `version` 从 `0.5.0` 改为 `0.5.1`, 这是仓库中唯一陈述产品版本的位置, 不改其他文件. 本地安装因此机械派生为 `0.5.1-pre`.

预估净增: 0 行 (一行替换).

## Acceptance criteria

- [x] 根 `package.json` 的 `version` 为 `0.5.1`, 其余内容不变.
- [x] 以临时 HOME 从源码本地安装后, 已安装的 `arw --version` 输出 `0.5.1-pre`.
- [x] 全量测试, 类型检查, 分发检查, `arw text check` 通过.

## Blocked by

- None - can start immediately

## Validation

- `pnpm test` 839 通过 / 0 失败; `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `node arw.mjs text check`, `git diff --check` 通过.
- 临时 HOME (`.tmp/v051-home`) 以 `node install.mjs --non-interactive --register-path false` 本地安装后, 已安装的 `arw --version` 输出 `0.5.1-pre`; 临时 HOME 已删除.
- 净增: 代码 +1 / -1 (净 0).

- 发布验证 (候选 `6a5353468bbc9792d5df0f5594109da84ae20bfb`, 均为 0.5.0 升级到 0.5.1):
  - `PASS win32 node 24.18.0 0.5.1 6a5353468bbc9792d5df0f5594109da84ae20bfb`
  - `PASS linux node 24.18.0 0.5.1 6a5353468bbc9792d5df0f5594109da84ae20bfb`
  - `PASS linux node 24.17.0 0.5.1 6a5353468bbc9792d5df0f5594109da84ae20bfb`
- Fixture: agent-assisted (`arw-0.5.0`) 上 `arw workflow update --non-interactive` 后 `workflow verify` 通过; plain 上按 `references/fixtures.md` 的参数 `arw workflow init --non-interactive` 后 `workflow verify` 通过.
- 最低 Node: VM 中没有 24.0.0, 以本地在 Node 24.0.0 上运行的 guest 检查步骤作为证据.
- 发布: tag `0.5.1` 与 main 指向候选, GitHub Release 含 `arw.tar.gz`; 公开 Bootstrap 在临时 HOME 安装后 `arw --version` 输出 `0.5.1`; agent-assisted fixture 已更新到 0.5.1 (tag `arw-0.5.1`).

## Comments

- 就绪记录为 `not-applicable` 例外 (无设计决定的单 issue, 用户 2026-11-02 确认), 在修改 `package.json` 前生成.
- 第 1 轮提交审核: 删除沿用旧 issue 模板的 `## Spec Requirement` 节 (issue 不列治理锚点); subject 因此变化, 例外记录按新 subject 重新生成.
- 发布验证中发现: Windows 的 guest 检查在装上一发布版之前写入非 ASCII PATH 项, 0.5.0 的安装器会把它弄坏, 检查因此失败. 这是检查顺序的问题, 不是候选的缺陷. 改为在上一版安装之后, 候选安装之前写入 (issue 0037, `6a53534`), 重跑后通过.
