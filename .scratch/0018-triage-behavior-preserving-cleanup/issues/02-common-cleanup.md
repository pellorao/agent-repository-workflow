# 复用公共排序并删除不可达判断

Status: completed

## What to build

处理台账 #97, #176, #174, #59, #112, 范围为 `lib/arw-common/issue-documents.mjs`, `lib/common/canonical-contract.mjs`, `lib/arw-common/artifacts.mjs`, `lib/arw-common/product-identity.mjs`. #97 合并两个完全相同的 sourceKey/message 诊断比较器. #176 删除 split 结果长度恒正的条件. #174 与 #59 复用 `compareText`, 保持代码单元排序. #112 删除 parseJsonText 调用外无生产异常来源的 catch, 保留解析结果中的无效 UTF-8 与 JSON 错误分类. 已逐处核对 HEAD.

净增预算: 非测试代码预计 -10 行, 上限 +10 行. 保持全部公开函数签名, 返回结构, 排序, 错误消息和持久状态.

## Acceptance criteria

- [x] 通过差异检查和 `tests/arw-common/artifacts.test.mjs` 验证五项清理全部完成, 诊断按原 sourceKey/message 规则排序, 中文路径和相同 sourceKey 的多条诊断不变.
- [x] 通过 `tests/arw-common/identity.test.mjs` 与 `tests/repository-workflow/cli.test.mjs` 的既有断言验证空路径, 根路径, 前后斜杠, 遍历路径, 无效 UTF-8, 无效 JSON 和错误软件包身份保持原结果.
- [x] 复用既有公共模块与身份测试; 完整 Source Checkout 验证包含 `pnpm test`, `pnpm typecheck`, 三个生产脚本, 受影响文件语法, 文本, 当前 effort 术语和差异检查, 全部通过.

## Blocked by

- None - can start immediately

## Validation

- `pnpm test`: 沙盒外完整套件 808 项通过, 0 失败, 3119.97819 毫秒.
- `pnpm typecheck`, 三个 Source Checkout 生产检查脚本, 四个受影响模块的 `node --check`, `node arw.mjs text check`, `node arw.mjs terms check --include .scratch/0018-triage-behavior-preserving-cleanup/`, `git diff --check`: 全部退出 0.
- `compareText` 与删除的局部实现逐字保持同一大小比较表达式; 两处 sourceKey/message 排序共同调用同一私有比较器. 路径 split 在空字符串时仍含一个元素, 空段与点号判断保留. 无效 UTF-8 与 JSON 仍从 parseJsonText 的诊断映射为原消息.
- 只删减与合并自查完成, 生产代码新增 17 行, 删除 26 行, 净减少 9 行, 未超预算. 测试文件未修改.

## Comments

Spec Readiness 首轮缺少 compareText 定义证据; 补入 `lib/common/json.mjs` 后由原 Reviewer 增量复审通过, 未修改要求或设计.

提交审核首轮要求移出 issue 0018:01 的独立 know 记录, 已取消该路径的暂存并由原要求符合 Reviewer 增量复审通过. 新旧候选仅差该 Comments 记录, 没有实现, 要求, 授权或验证事实变化, 依据 issue 记录章节与结论复用规则保留上一轮 Code Standards 无问题结果. 两轴报告分别为 `_commit-audit/4/requirements-reviewer/review.txt` 与 `_commit-audit/3/code-standards-reviewer/review.txt`, 均在本会话临时目录下.
