# 确定本地判断模型服务的运行责任

Type: grilling
Blocked by: issue:0099:16

##### Question

本地 Jev 类候选 (如 Laya, NeoHorse) 以本机 HTTP 服务提供 `/v1/systemone`. 这个服务由用户自己安装并保持运行, ARW 只知道端点 (与托管服务同等对待); 还是由 ARW Engine 按需启动和停止, 并负责与同机其他本地模型 (如 Strata) 分配显卡? 若由 ARW 管理, 是推广现有 Strata 提供方的 lease 机制, 还是另设一套?
