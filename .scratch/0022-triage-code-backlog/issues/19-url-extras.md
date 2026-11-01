# URL 附加部分校验共享

Status: needs-triage

## What to build

从 issue:0022:06 拆出 `.tmp/triage.md` 的 H32: 筛查 lib/release/release-validation-config.mjs 和 lib/arw-common/repository-configuration.mjs 中拒绝 userinfo, query 和 fragment 的重复实现. 新增共享导出涉及 Interface 和依赖边界, 按既有用户授权独立设计并运行 Spec Readiness. 当前仅记录规划, 不授权生产修改.

体积预算: 非测试源码净增不超过 10 行. 保留协议, .git 以及诊断限制. 命令输出, 公开行为, 错误结果和持久状态保持不变; 需要类型收窄级联, 新诊断码或规范变更的发现跳过并记录. 不修改 lib/background-agent/**, 不安装, 不 push.

预期验证: 实施前选择实际配置与发布测试, 完成完整 Source Checkout 验证, 包括 text check, 当前 effort 的 terms check 和 git diff --check. 相关边界: HTTP/HTTPS, 无效 URL, userinfo, query, fragment 和 .git 后缀.

## Acceptance criteria

- [ ] 设计和 Spec Readiness 完成, 已确认范围交付, 现有配置诊断和 URL 接受范围不变.
- [ ] 必要定向及完整仓库验证通过.

## Blocked by

无.
