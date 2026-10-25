# 将仓库配置与工作流锁状态分离

ARW 使用根目录 `arw.config.json` 保存用户拥有的仓库级配置. `arw-lock.json` 仍只保存 ARW Engine 管理的 Repository Profile 和派生锁状态.

当前定义的 `application` 部分保存应用身份, JIRA 来源和模块分发清单. 合法的 `application` 部分将仓库类型定为 `application`, 并固定绑定 Application Leader 角色. 缺少该部分时, 仓库类型为 `module`, 并固定绑定 Application Member 角色. 格式错误时关闭式失败. 仓库类型只决定当前仓库上下文的操作角色, ARW 不验证调用者的人员身份.

后续配置类别必须经过各自的设计才能加入. JIRA 用户名, 密码和令牌始终来自系统环境变量, 不写入仓库配置.
