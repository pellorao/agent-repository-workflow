# 使用按角色限定的受管理区域边界标记

## Decision

对于同时包含两种归属的文档, ARW 使用 role-fenced managed-region markers. 这是一对边界标记, 只说明内部内容由 `managed` 或 `repository-owned` 一方负责, 不在标记中重复 `regionId`.

`arw-lock.json` 仍是 `path`, 稳定 `regionId` 和完整受管理范围 SHA-256 的唯一归属记录. 原型证明两种候选语法在现有锁文件契约下具有相同的关闭式失败行为, 内容偏离检测和事务安全性. 因此选择较短的形式以减少 Agent 必须读取的常驻 token, 而不把边界标记本身当作归属证明.
