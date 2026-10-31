# 复用公共排序并删除不可达判断

Status: ready-for-agent

## What to build

处理台账 #97, #176, #174, #59, #112, 范围为 `lib/arw-common/issue-documents.mjs`, `lib/common/canonical-contract.mjs`, `lib/arw-common/artifacts.mjs`, `lib/arw-common/product-identity.mjs`. #97 合并两个完全相同的 sourceKey/message 诊断比较器. #176 删除 split 结果长度恒正的条件. #174 与 #59 复用 `compareText`, 保持代码单元排序. #112 删除 parseJsonText 调用外无生产异常来源的 catch, 保留解析结果中的无效 UTF-8 与 JSON 错误分类. 已逐处核对 HEAD.

净增预算: 非测试代码预计 -10 行, 上限 +10 行. 保持全部公开函数签名, 返回结构, 排序, 错误消息和持久状态.

## Acceptance criteria

- [ ] 通过差异检查和 `tests/arw-common/artifacts.test.mjs` 验证五项清理全部完成, 诊断按原 sourceKey/message 规则排序, 中文路径和相同 sourceKey 的多条诊断不变.
- [ ] 通过 `tests/arw-common/identity.test.mjs` 与 `tests/repository-workflow/cli.test.mjs` 的既有断言验证空路径, 根路径, 前后斜杠, 遍历路径, 无效 UTF-8, 无效 JSON 和错误软件包身份保持原结果.
- [ ] 复用既有公共模块与身份测试; 完整 Source Checkout 验证包含 `pnpm test`, `pnpm typecheck`, 三个生产脚本, 受影响文件语法, 文本, 当前 effort 术语和差异检查, 全部通过.

## Blocked by

- None - can start immediately
