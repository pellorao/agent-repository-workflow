---
description: Repository Profile 配置了 Code Map 根目录时, 更改覆盖范围内的源码, 或编写, 修改和核对 Code Map README 前使用.
name: code-maps
---

# Code Map

## When to use Code Maps

只有当 `arw-lock.json` 中的 Repository Profile 配置了一个或多个 Code Map 根目录时才使用 Code Map. 更改覆盖范围内的源码前, 读取已配置根目录中的 Code Map README, 以及管辖变更文件的每个更具体的 Code Map.

如果 issue 添加, 删除, 移动或大幅更改覆盖范围内的源码, 检查完整的受影响范围, 并在同一个 issue 中更新每个适用的 Code Map. 不得仅因目录存在就创建 Code Map.

## Authority and ownership

仓库负责每个 Code Map README. Main Agent 根据当前仓库源码和已经确认的设计文档编写其散文. ARW 命令只验证覆盖范围和结构, 不生成, 重写, 迁移, 降级或删除 Code Map 散文.

把 Repository Profile 作为已配置根目录, 包含路径匹配模式和排除路径匹配模式的权威来源. 不得根据语言, 框架, 测试配置或较早的 Workflow Distribution 副本推断 Code Map 范围.

Code Map 描述当前源码树. 它包含:

- 目录责任.
- 重要文件和子目录.
- 这些文件和目录之间的关系.
- 理解和更改代码所需的 Interface 和修改边界.

不得使用 Code Map 记录未来设计, 待办事项清单, 机械生成的清单, 或属于规范, ADR 或领域上下文的内容.

## Required format

Code Map 是使用 LF 行尾的普通 UTF-8 `README.md`. 其前置元数据精确包含一个受支持的版本字段和一个类型字段:

```markdown
---
code-map-version: 1
code-map-kind: directory
---
```

对于主要解释目录结构和用法的源码区域, Code Map 使用 `code-map-kind: directory`. 其二级标题按以下精确顺序排列:

1. `Overview`
2. `Directory Or File List`
3. `Directory Or File Relationships`
4. `Usage`
5. `Modification Boundaries`
6. `Related Documents`

如果覆盖区域提供一致的公开 Interface, 并且需要明确的阅读入口, 使用 `code-map-kind: module`. 其二级标题按以下精确顺序排列:

1. `Overview`
2. `Directory Or File List`
3. `Directory Or File Relationships`
4. `Public Interface`
5. `Reading Entry Points`
6. `Modification Boundaries`
7. `Related Documents`

列表内容必须有所取舍. 只有在某项的责任或关系能够帮助读者导航或安全修改覆盖范围内的源码时, 才提及它. 上级 Code Map 描述必要的下级 Code Map 和相关源码关系, 但不枚举排除路径, 仅测试路径或每个后代项.

## Verification and conflicts

更改已配置的 Code Map 或覆盖范围内的源码后, 运行 `arw code-map verify`. 完成 issue 前解决每个适用的问题.

不得覆盖必要 Code Map 路径中的普通 README. 没有适用的用户明确选择时, 不得删除或降级位于变更的 Repository Profile 之外的 Code Map. 如果当前源码, Repository Profile 和现有 Code Map 之间的分歧需要设计或责任归属决定, 停止受影响的写入并询问用户.
