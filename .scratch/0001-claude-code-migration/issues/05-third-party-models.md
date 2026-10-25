# 第三方模型接入

Status: ready-for-agent

## What to build

Reviewer 模型配置可以带一组环境变量 (如 `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_MODEL`), Claude 后端启动时注入. 凭据只允许出现在用户级配置中.

预估改动: 约 150 行.

## Spec Requirement

Governing requirements:

- `.scratch/0001-claude-code-migration/spec.md#platform-and-reviewer-runtime`

## Acceptance criteria

- [ ] 配置的环境变量被注入 `claude -p` 进程.
- [ ] 仓库配置中出现凭据时拒绝并说明.
- [ ] 使用手册写明配置方法.

## Blocked by

- 04 Claude 后端跑通 Reviewer
