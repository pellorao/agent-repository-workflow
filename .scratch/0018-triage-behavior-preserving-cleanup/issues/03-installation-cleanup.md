# 删除安装载荷与卸载中的死判断

Status: completed

## What to build

处理台账 #238, #233, #234, #235, #82, 范围为 `lib/installation/uninstallation.mjs`, `lib/installation/installation-payload.mjs`, `lib/arw-common/installation-manifest.mjs`. #238 对程序按安装目录生成的数据库路径直接用 relative 计算相对路径, 删除不可能越界的保护分支. #233 只删除 parseJsonText 已消化的 SyntaxError 分支. #234 将仅用于目标检查的载荷对象数组简化为已排序路径数组, 保留多个重复项的首个诊断路径. #235 直接把诊断字符串传给已接受 unknown 的 failed, 删除无用 Error 包装. #82 删除长度最多为 1 的责任归属数组的重复唯一性检查. 已在 HEAD 确认各生产者及约束.

净增预算: 非测试代码预计 -15 行, 上限 +10 行. 不运行真实安装或卸载, 不改变清单格式, 路径归属, CLI 输出, 错误结果或持久状态.

## Acceptance criteria

- [x] 通过差异检查和 `tests/installation/uninstallation.test.mjs` 验证五项清理全部完成, 消息数据库各伴随文件仍使用原安装相对路径.
- [x] 通过 `tests/installation/installation-payload.test.mjs` 及清单测试验证无效或非规范 JSON, 源目录读取失败, 多个重复目标的诊断顺序, 空责任归属及单条责任归属, 非法多条责任归属保持原结果.
- [x] 复用既有安装, 卸载与清单测试, 保留 Windows 和 Linux 两个平台的确定性覆盖. 完整 Source Checkout 验证包含 `pnpm test`, `pnpm typecheck`, 三个生产脚本, 受影响文件语法, 文本, 当前 effort 术语和差异检查, 全部通过.

## Blocked by

- None - can start immediately

## Validation

- `pnpm test`: 沙盒外完整套件 808 项通过, 0 失败, 2994.7289 毫秒. 沙盒内尝试因 JIRA 本地 HTTP 测试的 `listen EPERM 127.0.0.1` 失败后停止; 不属于产品回归.
- `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`: 全部退出 0.
- 三个受影响模块的 `node --check`, `node arw.mjs text check`, `node arw.mjs terms check --include .scratch/0018-triage-behavior-preserving-cleanup/`, `git diff --check`: 全部通过.
- 复核数据库路径由安装目录下固定生成, relative 与原解析结果一致; 责任归属长度上限仍先于逐项验证执行. 目标路径保持同一 compareText 排序及大小写归一化位置, 错误结果消息不变.
- 只删减与合并自查完成, 生产代码新增 16 行, 删除 22 行, 净减少 6 行, 未超预算. 测试文件未修改.

## Comments

know: 提交 `4905eb8`, 五项保行为清理完成, 两个 Commit Audit Reviewer 无问题, 无设计偏离和本 issue 遗留.
