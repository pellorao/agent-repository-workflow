# 文本策略重复清理

Status: needs-triage

## What to build

本 issue 属于 effort 0022, 处理 `.tmp/triage.md` 的 H12-H16. 实施前重新核对源码与全部调用方, 已修复项记为跳过. 当前仅完成分组规划, 不授权生产修改. 完成筛查后将确认范围和就绪审核或重构例外写在本章, 再更新状态.

- H12: 筛查 effort-start.mjs 与 commit-audit.mjs 的 Git 文本执行重复实现.
- H13-H14: 合并 lib/arw-common/text-policy.mjs 的错误构造, 删除已筛选修复目标的重复守卫.
- H15: 检查 validateText 的全部引用后删除未使用导出.
- H16: 筛查公共文本换行标准化的重复实现并保持原有输入输出合同.

体积预算: 非测试源码净增不超过 20 行. 只做当前清理, 不修改 `lib/background-agent/**`, 不安装, 不 push. 命令输出, 公开 Interface, 错误结果和持久状态保持不变; 需要类型收窄级联, 新诊断码或规范变更的发现跳过并记录.

预期验证: `node --test tests/common/text-policy.test.mjs tests/arw-common/*.test.mjs tests/commit-audit/*.test.mjs`, `pnpm test`, `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `node arw.mjs text check`, `node arw.mjs terms check --include .scratch/0022-triage-code-backlog/` 和 `git diff --check`. 定向文件路径在实施时核对, 不存在时选择该模块实际测试.

相关边界: Git 错误文字, blocked/failed 错误码, 无修复目标, CRLF, CR, LF.

## Acceptance criteria

- [ ] 已确认的范围完成, 已修复或不适用项明确记录, 可观察行为和公开合同不变.
- [ ] 取得预期验证通过证据, 原有边界覆盖继续通过.

## Blocked by

无.
