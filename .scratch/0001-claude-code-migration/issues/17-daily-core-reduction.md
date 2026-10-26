# 日常核心模块瘦身

Status: ready-for-agent

## What to build

ticket 12 跳过了每天运行的核心模块, GPT 式防御仍集中在这里 (审计: `manager.mjs` 116 个 throw, `spec-readiness.mjs` 125 个, `codex-app-server.mjs` 80 个). 按 `AGENTS.md` Efficiency First 的信任边界原则压缩 `lib/background-agent/`, `lib/reviewer-runtime/`, `lib/spec-readiness/`, `lib/commit-audit/`: 删除对内部数据的重复校验, 只用一次的辅助函数, 没有现实失败场景的错误处理. 对外行为不变.

预估改动: 这四个目录合计净减至少 20%; 开工前按文件写出行数预算.

## Spec Requirement

Governing requirements:

- `.scratch/0001-claude-code-migration/spec.md#code-reduction`

## Acceptance criteria

- [ ] 四个目录行数净减不少于 20%, 前后行数记入 `## Comments`.
- [ ] 完整测试套件通过, 只为被删除的功能删除测试.
- [ ] 两个平台各跑一次真实审核, 行为不变.

## Blocked by

- issue:0001:16
- issue:0001:21
