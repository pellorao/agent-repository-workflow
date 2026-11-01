# 安装引导局部清理

Status: needs-triage

## What to build

本 issue 属于 effort 0022, 处理 `.tmp/triage.md` 的 H44-H49. 实施前重新核对源码与全部调用方, 已修复项记为跳过. 当前仅完成分组规划, 不授权生产修改. 完成筛查后将确认范围和就绪审核或重构例外写在本章, 再更新状态.

- H44: 筛查 cli-prompt.mjs 的 settled 标记和关闭事件清理.
- H45-H46: 合并 bootstrap-artifact.mjs 与 installation-payload.mjs 的诊断文字构造, 内联单次使用 mapOpenFailure.
- H47-H48: 合并 bootstrap-artifact.mjs 相同成功返回并简化生成模板转义, 生成字节不变.
- H49: 删除 bootstrap.mjs 已验证 tag 的空字符串后备.

体积预算: 非测试源码净增不超过 10 行. 只做当前清理, 不修改 `lib/background-agent/**`, 不安装, 不 push. 命令输出, 公开 Interface, 错误结果和持久状态保持不变; 需要类型收窄级联, 新诊断码或规范变更的发现跳过并记录.

预期验证: `node --test tests/installation/*.test.mjs`, `pnpm test`, `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `node arw.mjs text check`, `node arw.mjs terms check --include .scratch/0022-triage-code-backlog/` 和 `git diff --check`. 定向文件路径在实施时核对, 不存在时选择该模块实际测试.

相关边界: 问题回答与关闭, EOF, 拒绝, check 模式一致或不一致, 生成脚本字节, 缺失或指定 tag.

## Acceptance criteria

- [ ] 已确认的范围完成, 已修复或不适用项明确记录, 可观察行为和公开合同不变.
- [ ] 取得预期验证通过证据, 原有边界覆盖继续通过.

## Blocked by

无.
