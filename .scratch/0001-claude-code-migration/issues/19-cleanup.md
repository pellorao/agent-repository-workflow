# 迁移遗留清理

Status: ready-for-agent

## What to build

ticket 15 冒烟和审计发现的小问题:

- 长期 spec "Platform support" 一节过时 (仍写 Claude Reviewer 暂停执行).
- `arw print issue:0001:*` 对整个 effort 解析失败 (Blocked by 格式, `in-progress` 状态): 修正本 effort 的 issue 记录, 并确认解析器的报错能指出具体文件和行.
- `arw terms check` 的 `Artifact` 术语和中文比例两项在本仓库一直失败.
- `arw lba` 的 Main 标题取到注入的 "# AGENTS.md instructions for …": 跳过注入指令, 从用户消息取标题.
- 从源码运行需要手放 `config.json`: 源码运行时缺省使用默认值.
- ticket 10, 11 的 Status 与勾选不一致.

预估改动: 约 60 行.

## Spec Requirement

Governing requirements:

- `.scratch/0001-claude-code-migration/spec.md#migration-sequencing`

## Acceptance criteria

- [ ] 上述各项修复, `arw print`, `arw terms check` 在本仓库通过.
- [ ] 全量测试和分发检查通过.

## Blocked by

- 15 冒烟发现的日常使用问题
