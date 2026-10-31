# 简化 Code Map 内部重复检查

Status: ready-for-agent

## What to build

处理台账 #247, #248, #250, #252, 仅修改 `lib/repository-workflow/code-map.mjs`. #247 直接调用已经规范化根目录点号的 joinRelativePath, 删除 README, 探针和遍历子路径上的根目录特判. #248 删除同一字节缓冲区前四字节已确认为 frontmatter 分隔符且成功解码后的重复 startsWith 判断. #250 删除在最终同一比较器排序前的中间排序. #252 删除仅在已经保证 Git 存在的分支调用的 requiredGit 辅助函数及其不可达保护, 必要时只使用局部类型断言, 不改类型体系. 已逐处核对 HEAD 及调用前提.

净增预算: 非测试代码预计 -10 行, 上限 +5 行. 不改变公开 Interface, 路径语义, 读取次序, 诊断结果, CLI 输出或持久状态.

## Acceptance criteria

- [ ] 通过差异检查和 `tests/repository-workflow/code-map.test.mjs` 验证四项删除或合并, 根目录及嵌套目录的 README 与探针路径保持不变.
- [ ] 通过 `tests/repository-workflow/code-map.test.mjs` 验证缺失 Git, 已提供仓库状态, 普通 README, 非法 UTF-8, frontmatter 与多根目录诊断排序保持原结果.
- [ ] 复用现有测试, 不增加同义反复测试. 完整 Source Checkout 验证包括 `pnpm test`, `pnpm typecheck`, 三个生产脚本, 受影响文件语法, 文本, 当前 effort 术语和差异检查, 全部通过.

## Blocked by

- None - can start immediately
