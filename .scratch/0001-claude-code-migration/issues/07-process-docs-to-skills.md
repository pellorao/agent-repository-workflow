# 流程文档改为自动触发的 Skill

Status: ready-for-agent

## What to build

按 spec 列表把流程文档改为由描述自动触发的 Skill (实施, 提交, Spec Readiness, Reviewer 启动, issue 跟踪, 验证, 领域建模, ARW 命令, Code Map, 规则与设计修改, 测试清理, 测试性能优化), 删除文档间重复陈述. `implement` 开头重申最高原则. Reviewer 协议和角色文件仍由运行时读取.

预估改动: 规则净减.

## Spec Requirement

Governing requirements:

- `.scratch/0001-claude-code-migration/spec.md#rule-structure-and-context-budget`

## Acceptance criteria

- [ ] 最重日常流程不超过 40K token, 预算测试覆盖并通过.
- [ ] 同一要求只在一处定义.
- [ ] 两个平台的投影和分发副本同步.

## Blocked by

- 06 常驻核心规则与预算测试
