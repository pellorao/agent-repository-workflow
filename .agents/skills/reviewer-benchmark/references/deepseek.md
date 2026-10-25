# DeepSeek 操作

只有选定模型使用 DeepSeek API 连接时, 才读取本文.

进行 API 专用设置或验证前, 根据当前官方 [Responses API 指引](https://api-docs.deepseek.com/guides/responses_api/)和[模型映射](https://api-docs.deepseek.com/quick_start/pricing/)核对已配置的原生提供方. 明确用户选定的模型标识和原生推理强度. 区分配置标识, 请求参数与实际观察到的 API 身份; 不仅凭客户端设置声称已核实服务端模型或档位.

使用现有原生提供方已配置的 `env_key` 认证. 只检查该提供方是否能取得必要凭据, 不把凭据值带入提示, 报告, 命令输出或工具环境. 凭据缺失是设置故障, 不是模型质量 0 分. 更改认证, 提供方配置或模型映射需要相应授权.

采集仍使用共享 Reviewer 机器入口和公共角色合同. 本文不维护 DeepSeek 执行器, 模型配置集合, 推理默认值, 容量, 价格表或独立评分路径. 将具体 API 设置故障记录在本次运行的临时证据与活动 issue 中, 保留绑定报告和已知计量事实.
