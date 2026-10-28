# Seam evidence

## Deterministic Adapter

Policy Evaluation 的两个 Adapter 使用 access-review Seam 的 allowed decision 以及 Interfaces 的 denied, invalid-policy 和 invalid-request 成功或输入拒绝合同. Live Adapter 用 production policy engine 对传入的 policy 和 facts 求值, deterministic Adapter 返回配置的同类结果; 校验顺序均先 policy 后 facts. Runtime environment 选择 Adapter, 不选择 policy. 同配置时得到同一 decision, 不同配置允许不同 decision.
