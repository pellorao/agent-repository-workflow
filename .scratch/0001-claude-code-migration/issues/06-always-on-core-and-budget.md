# 常驻核心规则与预算测试

Status: completed

## What to build

重写常驻规则 (迁移期编辑 `AGENTS.md.bak`, 第 13 项恢复原名): 最前面是效率与精简最高原则, 其后只保留前置依赖, 重要决定交用户, Agent 写入范围, 输出文字和触发索引, 常驻总量不超过 8K token. 删除 `writing.md` 最小充分合同的出口条文, 删除 `user-communication.md` 和 `subagent-allocation.md` 的容量部分, 规则冲突以用户级规则为准. 仓库自有区域声明按待办自主推进的工作方式. 新增规则预算测试.

预估改动: 规则净减.

## Spec Requirement

Governing requirements:

- `.scratch/0001-claude-code-migration/spec.md#rule-structure-and-context-budget`

## Acceptance criteria

- [x] 常驻规则不超过 8K token, 预算测试覆盖并通过.
- [x] 最高原则位于常驻规则最前面.
- [x] 分发副本同步.

## Blocked by

- None - can start immediately
