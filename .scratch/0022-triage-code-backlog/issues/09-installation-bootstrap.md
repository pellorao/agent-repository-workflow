# 安装引导局部清理

Status: completed

## What to build

本 issue 属于 effort 0022, 处理 `.tmp/triage.md` 的 H44-H49. 实施前重新核对源码与全部调用方, 已修复项记为跳过. 已核对当前源码及调用边界, 本轮授权以下局部清理. H45 需要公共诊断文字能力, 已拆至 issue:0022:21 独立设计并运行 Spec Readiness, 本轮不实施.

- H44: 筛查 cli-prompt.mjs 的 settled 标记和关闭事件清理.
- H46: 内联 bootstrap-artifact.mjs 单次使用的 mapOpenFailure.
- H47-H48: 合并 bootstrap-artifact.mjs 相同成功返回并简化生成模板转义, 生成字节不变.
- H49: 已核对, 简化 tag 后出现严格类型检查错误, 按本 issue 的类型收窄边界保留原实现.

行为保持重构例外: 只删除死代码或不可达分支, 或合并完全相同的重复实现; 命令输出, 公开 Interface, 错误结果和持久状态不变; 不改变 Module 责任, Interface, Seam, 依赖方向, 权威来源或数据流; 不改动长期规范. 不运行 Spec Readiness, 提交审核照常运行.

体积预算: 非测试源码净增不超过 10 行. 只做当前清理, 不修改 `lib/background-agent/**`, 不安装, 不 push. 命令输出, 公开 Interface, 错误结果和持久状态保持不变; 需要类型收窄级联, 新诊断码或规范变更的发现跳过并记录.

预期验证: `node --test tests/installation/*.test.mjs`, `pnpm test`, `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `node arw.mjs text check`, `node arw.mjs terms check --include .scratch/0022-triage-code-backlog/` 和 `git diff --check`. 定向文件路径在实施时核对, 不存在时选择该模块实际测试.

相关边界: 问题回答与关闭, EOF, 拒绝, check 模式一致或不一致, 生成脚本字节, 缺失或指定 tag.

## Acceptance criteria

- [x] 已确认的范围完成, 已修复或不适用项明确记录, 可观察行为和公开合同不变.
- [x] 取得预期验证通过证据, 原有边界覆盖继续通过.

## Blocked by

无.

## Validation

- H44: 删除重复的 settled 标记, 由 Promise 保证只结算一次; 回答与拒绝保持在原有 then 回调中清理 close 监听. 既有 cli-prompt 测试覆盖答案表, 重问, 关闭及 EOF.
- H46: 只内联文件系统打开结果的单次分类, 诊断码, stage 和文字保持不变. H47: 合并相同成功返回, check 不一致仍阻断且不写入. H48: 模板转义简化后生成脚本字节与 HEAD 相同, scripts/install-arw.mjs 无差异.
- 安装模块定向测试 `node --test --test-reporter=./tests/helpers/test-reporter.mjs tests/installation/*.test.mjs` 提权复跑通过, 共 106 个测试, 0 个失败. 沙盒中的定向运行停滞, 已停止. 完整 `pnpm test` 通过, 共 814 个测试, 0 个失败. 未新增或语义修改测试.
- `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, 两个受影响源码的 `node --check`, text check, 当前 effort 的 terms check, 两个 issue 的 language inspect 和 `git diff --check` 均通过.
- 非测试源码新增 13 行, 删除 25 行, 净减少 12 行, 满足 10 行预算. 提交前删减自查未发现其他必要合并.

## Comments

- 2026-11-01: H45 的通用诊断文字拼接需要公共能力及共享导出, 按既有授权拆至 issue:0022:21, 本轮未实施. H49 删除空字符串后备后, 严格类型检查在 tag 校验及 Installer 输入处报告 string | undefined, 按本 issue 的类型收窄边界恢复原实现, 生成副本也已恢复.

- 第 1 轮 Code Standards 和要求符合 Reviewer 均正常完成, 报告均为 No problems. Main Agent 抽查内联的打开失败分类, 回归核对提示的回答, 关闭, 普通拒绝, 已关闭拒绝及两种回答关闭顺序, 共 6 种情境的公开结果与 HEAD 相同; 只读基线比较因沙盒拒绝 Node 子进程执行 Git, 提权复跑通过. check 模式不一致仍在 write 前返回阻断, 既有生成与写入测试通过. 本轮之后仅补充本章记录.
