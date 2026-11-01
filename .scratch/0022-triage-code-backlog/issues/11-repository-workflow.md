# 仓库工作流重复清理

Status: completed

## What to build

本 issue 属于 effort 0022, 处理 `.tmp/triage.md` 的 H55-H59. 实施前重新核对源码与全部调用方, 已修复项记为跳过. 已核对当前源码及调用方, 本轮授权 H55-H56 和 H58 的局部重复清理. H57 和 H59 移至 issue:0022:22, 独立设计并运行 Spec Readiness.

- H55-H56: 合并 workflow.mjs 文件系统结果检查并删除不可达守卫.
- H57: 移至 issue:0022:22; 定位逻辑属于通用能力, 需先确认公共模块边界及 Buffer 字节与字符串索引差异.
- H58: 合并策略文件内容有效性判断并保留各诊断.
- H59: 移至 issue:0022:22; 动态导入改为静态导入不属于删除死代码或合并相同重复实现.

行为保持重构例外: 只删除死代码或不可达分支, 或合并完全相同的重复实现; 命令输出, 公开 Interface, 错误结果和持久状态不变; 不改变 Module 责任, Interface, Seam, 依赖方向, 权威来源或数据流; 不改动长期规范. 不运行 Spec Readiness, 提交审核照常运行.

体积预算: 非测试源码净增不超过 10 行. 只做当前清理, 不修改 `lib/background-agent/**`, 不安装, 不 push. 命令输出, 公开 Interface, 错误结果和持久状态保持不变; 需要类型收窄级联, 新诊断码或规范变更的发现跳过并记录.

预期验证: `node --test tests/repository-workflow/*.test.mjs`, `pnpm test`, `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `node arw.mjs text check`, `node arw.mjs terms check --include .scratch/0022-triage-code-backlog/` 和 `git diff --check`. 定向文件路径在实施时核对, 不存在时选择该模块实际测试.

相关边界: 文件系统失败, Markdown 前置元数据 缺失和闭合, 策略缺失或损坏, 交互输入与终端.

## Acceptance criteria

- [x] 已确认的范围完成, 已修复或不适用项明确记录, 可观察行为和公开合同不变.
- [x] 取得预期验证通过证据, 原有边界覆盖继续通过.

## Blocked by

无.

## Validation

- H55-H56: 将原有失败检查收进私有断言函数, 原始诊断消息, arwCode 和 EINVAL/EIO 分类保持不变; 删除不可达守卫, 严格类型检查通过, 不需要公开类型收窄.
- H58: 合并 .arwignore 内容验证, 保留缺失, 非普通文件和无效文本的分支诊断及阶段. Repository State Inspector 的 policy 与 files['.arwignore'].observed 来自同一观察, 读取与短路语义保持一致.
- 定向 node --test --test-reporter=./tests/helpers/test-reporter.mjs tests/repository-workflow/*.test.mjs 通过, 共 4 个测试文件. 完整 pnpm test 通过, 共 814 个测试, 0 个失败. 未新增或语义修改测试.
- pnpm typecheck, 三个分发与投影脚本, node --check lib/repository-workflow/workflow.mjs, text check, 当前 effort 的 terms check, 两个 issue 的 language inspect 和 git diff --check 均通过.
- 非测试源码新增 26 行, 删除 22 行, 净增 4 行, 满足 10 行预算. 提交前删减自查已删除私有 validateCodeMapProfile 的冗余 policy 参数, 未发现其他必要合并.

## Comments

- 2026-11-01: H57 的通用定位与 H59 的加载时机调整移至 issue:0022:22, 按既有授权独立设计和 Spec Readiness; 本轮保留原实现.

- 第 1 轮 Code Standards 和要求符合 Reviewer 均正常完成, 报告均为 No problems. Main Agent 抽查文件系统断言的原始错误字段与分类, 回归核对文件事务回滚测试和损坏策略阻断确认的 CLI 测试, 并核对 policy 与文件观察同源. 本轮之后仅补充本章记录.
