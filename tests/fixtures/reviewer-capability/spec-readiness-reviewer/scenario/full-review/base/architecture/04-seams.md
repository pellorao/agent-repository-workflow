# Seam evidence

## Deterministic Adapter

Policy Evaluation 的两个 Adapter 使用 access-review Interfaces 的 allowed, denied, invalid-policy 和 invalid-request 成功或输入拒绝合同. Live Adapter 使用 Input author 的 production policy, deterministic Adapter 使用配置的同类 policy 和 facts; 校验顺序均先 policy 后 facts. Runtime environment 选择 Adapter pairing. 同配置时得到同一 decision, 不同配置允许不同 decision.
