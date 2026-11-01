# JSON 与文档术语清理

Status: needs-triage

## What to build

本 issue 属于 effort 0022, 处理 `.tmp/triage.md` 的 H38-H43. 实施前重新核对源码与全部调用方, 已修复项记为跳过. 当前仅完成分组规划, 不授权生产修改. 完成筛查后将确认范围和就绪审核或重构例外写在本章, 再更新状态.

- H38: 将 JSON 递归克隆与边界校验分离, 保留公开 cloneJsonValue 和写入删除的校验.
- H39: 合并 markdown-visible-text.mjs 的引用前缀正则.
- H40: 合并 document-terms-repository.mjs 的隐式目录判断.
- H41-H42: 删除 contextResultFrom 未使用默认值与 analyzeTerms 未读取返回字段.
- H43: 将相同诊断排序集中到 resultFrom, 保持输出顺序.

体积预算: 非测试源码净增不超过 10 行. 只做当前清理, 不修改 `lib/background-agent/**`, 不安装, 不 push. 命令输出, 公开 Interface, 错误结果和持久状态保持不变; 需要类型收窄级联, 新诊断码或规范变更的发现跳过并记录.

预期验证: `node --test tests/common/json.test.mjs tests/common/markdown-visible-text.test.mjs tests/document-terms/*.test.mjs`, `pnpm test`, `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `node arw.mjs text check`, `node arw.mjs terms check --include .scratch/0022-triage-code-backlog/` 和 `git diff --check`. 定向文件路径在实施时核对, 不存在时选择该模块实际测试.

相关边界: 非法 JSON, 深层写入删除, 引用与列表缩进, 隐式目录, include 诊断排序.

## Acceptance criteria

- [ ] 已确认的范围完成, 已修复或不适用项明确记录, 可观察行为和公开合同不变.
- [ ] 取得预期验证通过证据, 原有边界覆盖继续通过.

## Blocked by

无.
