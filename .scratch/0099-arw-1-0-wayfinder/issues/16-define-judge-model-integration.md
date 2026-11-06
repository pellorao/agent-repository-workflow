# 定义 Engine 调用 Jev 类模型的接入方式

Type: grilling
Blocked by: issue:0099:05

##### Question

Jev 类模型只回答固定选项问题, 不是 Agent: Engine 应直接调用 `/v1/systemone` 兼容接口 (托管 Jev 与多数开源候选都提供), 还是把它作为后台 Agent 提供方接入现有用户级管理进程 (同 Strata 的方式)? 托管与本地候选怎样切换, 凭据, 超时, 不可用时的回退 (直接交高智能 Agent) 和调用记录放在哪里?
