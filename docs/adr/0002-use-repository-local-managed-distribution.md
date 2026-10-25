# 使用 Git 仓库本地受管 Workflow Distribution

ARW 将 Workflow Distribution 安装到目标 Git 仓库并随代码版本控制. Workflow Distribution 是一版可安装的共享工作流规则及其配套软件包. 目标 Git 仓库中的本地副本是 Agent 编码运行时的权威来源; 运行时不读取全局安装目录, ARW 源码仓库, 软件包缓存或远程 Baseline.

ARW 只拥有当前 `arw-lock.json` 明确登记的 Managed Content, 即由 ARW 检查和更新的文件或文件内区域. 其余内容始终归目标 Git 仓库所有. 内容偏离登记状态, 边界标记损坏, 或无法证明归属时, 更新必须停止, 不得覆盖或自动合并. 这样既能审计和复现工作流, 也不会侵犯仓库拥有的内容.

`workflow init` 可以采用目标位置已存在且与当前计划完全相同的字节, 即使旧锁文件无法证明它们归 ARW 所有. 这种采用不改变内容, 也不扩大 ARW 修改仓库自有字节的权限. 字节不同时, 仍须依冲突和归属规则停止或取得明确处理决定. `workflow update`, `verify` 和 `remove` 仍只依赖有效锁文件中已登记的归属; 初始化时采用相同字节不构成通用接管规则.
