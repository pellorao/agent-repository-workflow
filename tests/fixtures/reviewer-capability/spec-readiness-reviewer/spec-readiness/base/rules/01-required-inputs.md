# 输入规则

## Required Inputs

本文件是 protected operation 使用的 security authority Input. Existing caller boundary 必须在 operation 之前验证 caller identity, 只把 verified principal 和 requested operation 交给 review boundary. Review boundary 信任该 verified principal, 不接受 caller 自报 identity 或 credential.
