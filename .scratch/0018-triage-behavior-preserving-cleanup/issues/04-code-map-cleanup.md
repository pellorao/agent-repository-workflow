# 简化 Code Map 内部重复检查

Status: completed

## What to build

处理台账 #247, #248, #250, #252, 仅修改 `lib/repository-workflow/code-map.mjs`. #247 直接调用已经规范化根目录点号的 joinRelativePath, 删除 README, 探针和遍历子路径上的根目录特判. #248 删除同一字节缓冲区前四字节已确认为 frontmatter 分隔符且成功解码后的重复 startsWith 判断. #250 删除在最终同一比较器排序前的中间排序. #252 删除仅在已经保证 Git 存在的分支调用的 requiredGit 辅助函数及其不可达保护, 必要时只使用局部类型断言, 不改类型体系. 已逐处核对 HEAD 及调用前提.

净增预算: 非测试代码预计 -10 行, 上限 +5 行. 不改变公开 Interface, 路径语义, 读取次序, 诊断结果, CLI 输出或持久状态.

## Acceptance criteria

- [x] 通过差异检查和 `tests/repository-workflow/code-map.test.mjs` 验证四项删除或合并, 根目录及嵌套目录的 README 与探针路径保持不变.
- [x] 通过 `tests/repository-workflow/code-map.test.mjs` 验证缺失 Git, 已提供仓库状态, 普通 README, 非法 UTF-8, frontmatter 与多根目录诊断排序保持原结果.
- [x] 复用现有测试, 不增加同义反复测试. 完整 Source Checkout 验证包括 `pnpm test`, `pnpm typecheck`, 三个生产脚本, 受影响文件语法, 文本, 当前 effort 术语和差异检查, 全部通过.

## Blocked by

- None - can start immediately

## Validation

- `pnpm test`: 沙盒外完整套件 810 项通过, 0 失败, 2971.217668 毫秒.
- `pnpm typecheck`, 三个 Source Checkout 生产检查脚本, `node --check lib/repository-workflow/code-map.mjs`, `node arw.mjs text check`, `node arw.mjs terms check --include .scratch/0018-triage-behavior-preserving-cleanup/`, `git diff --check`: 全部退出 0.
- 抽查 joinRelativePath 对根目录点号的规范化与原分支相同; UTF-8 解码前的 frontmatter 四字节检查保留. 最终诊断仍由原 compareDiagnostic 排序. 缺失 Git 且没有仓库状态时仍抛原入口错误, 已提供状态的分支不使用 liveGit.
- 只删减与合并自查完成, 生产代码新增 9 行, 删除 14 行, 净减少 5 行, 未超预算.
- Commit Audit 指出的验收覆盖缺口已补充到现有测试文件: 普通 README 与多根目录最终排序, 根目录点号下 README 和嵌套路径, 缺失 Git 的原始错误, 无 Git 的 Repository 状态输入, 状态和实时 Git 两种探针排除路径. 两个新增回调经沙盒外 spec 报告器测得 0.244661 和 1.667433 毫秒, 均低于 100 毫秒阈值. 测试文件语法检查通过.

## Comments

- 筛选跳过 #15, #102: 共享表格格式化会改变宽字符 CLI 输出. 跳过 #80: 修正含 `$` 的编辑器参数会改变现有行为. 跳过 #91: 修正粗体阻断项解释会改变执行资格. 跳过 #169: 共享 Git 文件模式判断会改变接受范围. 跳过 #173: 移除额外规范化会改变非 JSON 对象的序列化结果. 这些条目未作为本 effort 的保行为实施项.
- Code Map Spec Readiness 结束回执曾因报告目录中的四个空隐藏目录被拒绝; 仅移除空目录后, 原 Reviewer 的 list_agents 确认 ready, 原报告字节不变, 正常 generate 与 promote 通过.
- know: 提交 `43f1636`, 四项保行为清理完成. 补充验收覆盖后, 原两位 Commit Audit Reviewer 复审均无问题; Gate 2 没有治理文档差异. 无设计偏离和已确认实施项遗留. 当前环境未配置状态页, 本 effort 的 know 记录保存在各 issue 的 Comments.
