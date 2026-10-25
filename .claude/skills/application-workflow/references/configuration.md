# 配置

只在用户明确调用 `application-workflow`, 并明确请求初始化或设置 Application 类型仓库的配置后, 才使用此阶段.

## Repository role

Application 类型仓库的根 `arw.config.json` 包含完整的 `application` 对象. 该仓库绑定 Application Leader 角色. 没有该对象的仓库属于 `module` 类型, 使用 Application Member 角色和对应授权. ARW 不认证运行命令的人员身份.

## Required configuration

按以下要求准备由用户维护的 `arw.config.json`:

- `configVersion: 2`.
- `application.name`, 使用小写字母, 数字和连字号.
- `application.submoduleRemote` 和 `application.submoduleDistributionBranch`.
- `application.modules`, 包含 Module 类型仓库的唯一名称, 以及相对于仓库根目录的唯一安全路径.
- `application.jira.baseUrl`, `projectKey`, `issueType`, `candidateStatus`, `acceptedStatus` 和 `completedStatus`.

不得在上述配置文件中存储认证信息. 除打开浏览器外, 所有 JIRA 操作都从当前进程环境读取 `JIRA_ACCESS_TOKEN`. ARW 安装目录中的 `config.json` 可以使用正整数 `jira.listLimit` 设置列表结果上限.

## Setup boundary

创建或更改配置前, 先向用户解释建议的内容, 并请求仓库规则要求的写文件授权.

配置请求不授权运行 `arw workflow init`. 只有初始化自身的要求和授权都已满足后, 才运行该命令.

对已初始化的 Application 类型仓库, 以下命令只读验证现有配置, 且不访问 JIRA:

```text
arw workflow verify
```

配置验证通过不能证明已配置的远程仓库, 分支或子模块确实存在. 在依赖这些事实的生命周期操作前, 单独检查它们.
