# 清理 CLI 内部重复与恒定判断

Status: completed

## What to build

处理台账 #118, #122, #124, #129, 仅修改 `lib/arw.mjs`. #118 只删除字符串参数在长度或调用方校验后的重复 typeof 判断, 不改变错误顺序或文本. #122 把工作流命令种类的重复分支改为等价模板. #124 合并 open 与 print 的目标解析, 诊断输出和缺失处理, 保留原调用顺序. #129 删除必有值上的可选链. 已在 HEAD 确认这些位置仍存在; #113, #115, #123 已不存在, 不重做.

净增预算: 非测试代码预计 -15 行, 上限 +10 行. 不增加导出, 不改变 CLI 输出, 退出码, 错误结果, 文件写入或公开 Interface.

## Acceptance criteria

- [x] 通过差异检查和 `tests/arw-common/artifact-cli.test.mjs` 验证上述四项在当前实现中被删除或合并, open 与 print 的诊断, 无目标抛错和成功输出保持一致.
- [x] 通过 `tests/application-jira/cli.test.mjs` 与 `tests/repository-workflow/cli.test.mjs` 验证参数缺失, 空字符串, 空白, 控制字符, 未知工作流命令和编辑器启动失败的既有结果不变.
- [x] 复用现有 CLI 测试覆盖, 不新增重复测试. `pnpm test`, `pnpm typecheck`, 三个 Source Checkout 脚本, 受影响文件 `node --check`, 文本, 术语和差异检查全部通过.

## Blocked by

- None - can start immediately

## Validation

- `pnpm test`: 沙盒外完整套件 808 项通过, 0 失败, 3126.525077 毫秒.
- `pnpm typecheck`, 三个 Source Checkout 生产检查脚本, `node --check lib/arw.mjs`, `node arw.mjs text check`, `node arw.mjs terms check --include .scratch/0018-triage-behavior-preserving-cleanup/`, `git diff --check`: 全部退出 0.
- `tests/arw-common/artifact-cli.test.mjs` 覆盖原始打印, 无目标, 结构诊断, 编辑器失败; Application JIRA 与 Repository Workflow 测试覆盖有效及无效参数路由. 抽查合并后的目标解析保持诊断先于操作, 有诊断返回 1, 无目标且无诊断抛原消息.
- 只删减与合并自查完成, 生产代码新增 20 行, 删除 45 行, 净减少 25 行, 未超预算. 测试文件未修改.
