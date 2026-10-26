# 安装器管道输入与半途失败

Status: needs-triage

## What to build

ticket 21 冒烟 (2026-10-27) 发现: `node install.mjs` 用 `<<< n` 之类的单行管道应答时报 "Interactive input ended"; 安装中途失败会留下缺少 `lib/` 的安装目录. 修正为能读取管道输入, 且失败时不留下不完整的安装目录.

预估净增约 30 行.

## Spec Requirement

Governing requirements:

- `docs/specs/agent-repository-workflow-installation/spec.md`

## Acceptance criteria

- [ ] 单行管道应答可以完成安装.
- [ ] 安装中途失败后, 不存在不完整的安装目录.

## Blocked by

- None - can start immediately
