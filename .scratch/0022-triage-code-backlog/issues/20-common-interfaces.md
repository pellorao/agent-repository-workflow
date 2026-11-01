# 公共文档语言输入与文件系统导出清理

Status: needs-triage

## What to build

从 issue:0022:07 拆出 `.tmp/triage.md` 的 H33, H34 和 H36. H33 筛查 analyzeDocumentLanguage 的 BodyFlow 输入字段及文档语言调用方; H34 筛查 filesystem.mjs 与 file-transaction.mjs 的重复 diagnostic 构造; H36 筛查 logicalPath 与 repository.mjs 中的重复路径表达式. 修改导出函数输入类型或新增跨模块导出涉及 Interface 和依赖边界, 按既有用户授权独立设计并运行 Spec Readiness. 当前仅记录规划, 不授权生产修改.

体积预算: 非测试源码净增不超过 10 行. 保持命令输出, 错误结果和持久状态不变; 需要类型收窄级联, 新诊断码或规范变更的发现跳过并记录. 不修改 lib/background-agent/**, 不安装, 不 push.

预期验证: 实施前选择实际公共文件系统, 文件事务, 仓库路径和文档语言测试, 完成完整 Source Checkout 验证, 包括 text check, 当前 effort 的 terms check 和 git diff --check. 相关边界: 可选诊断路径, 根目录与路径分隔符, 正文筛选和字母统计.

## Acceptance criteria

- [ ] 设计和 Spec Readiness 完成, 已确认范围交付, 文件系统诊断, 仓库路径和文档语言检查结果不变.
- [ ] 必要定向及完整仓库验证通过.

## Blocked by

无.
