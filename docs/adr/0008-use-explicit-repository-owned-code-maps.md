# 使用显式配置与 Repository-owned Code Maps

ARW 不扫描源码或解析测试框架配置来推断 Code Map 是否适用. 幂等 `arw workflow init` 将用户提供的递归根目录, 仓库相对包含路径模式和排除路径模式写入 `arw-lock.json` 的 Repository Profile. 统一采用仓库相对路径模式虽然减少了部分配置便利, 却避免同一产品出现两种相对路径解释, 并保持与语言和框架无关.

Code Map README 由 `code-map-version` 和 `code-map-kind` 前置元数据识别, 始终归仓库所有. 标题只作为有版本的结构接受验证. Main Agent 在 issue 工作流中生成, 更新, 迁移或删除 README. ARW 工作流初始化和更新只计算覆盖范围并报告缺口; 配置变化使文件不再需要时, 依显式 `delete|demote` 选择处理.

这种安排使适用范围可以审计和重放, 同时不覆盖仓库原有的说明文字. 上级 Code Map 只描述匹配的来源及必需的子 Code Map, 不描述排除项, 仅测试项或其他非必需子目录.
