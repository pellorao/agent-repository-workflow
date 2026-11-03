# JSON 与文档术语清理

Status: completed

## What to build

本 issue 属于 effort 0022, 已重新核对 `.tmp/triage.md` 的 H38-H43 及调用方, 本轮实施全部六项. 改动限于文件内重复实现和未使用值, 不新增共享导出或改变公开输入输出. JSON 公开入口保留原有参数校验顺序和错误, 私有递归仅消费已校验值. 诊断排序保留原比较器和复制语义, include 诊断重复排序不改变结果.

- H38: 将 JSON 递归克隆与边界校验分离, 保留公开 cloneJsonValue 和写入删除的校验.
- H39: 合并 markdown-visible-text.mjs 的引用前缀正则.
- H40: 合并 document-terms-repository.mjs 的隐式目录判断.
- H41-H42: 删除 contextResultFrom 未使用默认值与 analyzeTerms 未读取返回字段.
- H43: 将相同诊断排序集中到 resultFrom, 保持输出顺序.

行为保持重构例外: 只删除死代码或不可达分支, 或合并完全相同的重复实现; 命令输出, 公开 Interface, 错误结果和持久状态不变; 不改变 Module 责任, Interface, Seam, 依赖方向, 权威来源或数据流; 不改动长期规范. 不运行 Spec Readiness, 提交审核照常运行.

体积预算: 非测试源码净增不超过 10 行. 只做当前清理, 不修改 `lib/background-agent/**`, 不安装, 不 push. 命令输出, 公开 Interface, 错误结果和持久状态保持不变; 需要类型收窄级联, 新诊断码或规范变更的发现跳过并记录.

预期验证: `node --test tests/common/json.test.mjs tests/common/markdown-visible-text.test.mjs tests/document-terms/*.test.mjs`, `pnpm test`, `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `node arw.mjs text check`, `node arw.mjs terms check --include .scratch/0022-triage-code-backlog/` 和 `git diff --check`. 定向文件路径在实施时核对, 不存在时选择该模块实际测试.

相关边界: 非法 JSON, 深层写入删除, 引用与列表缩进, 隐式目录, include 诊断排序.

## Acceptance criteria

- [x] 已确认的范围完成, 已修复或不适用项明确记录, 可观察行为和公开合同不变.
- [x] 取得预期验证通过证据, 原有边界覆盖继续通过.

## Blocked by

- None - can start immediately

## Validation

- H38: JSON 公开入口保持原有校验顺序和 TypeError 消息, 私有递归只克隆已校验值. 既有 JSON 路径测试覆盖 __proto__ 普通键; 额外内存核对 cloneJsonValue 的深层对象独立性, 写入根与 nextValue 独立性, 深层删除, undefined, NaN 和嵌套非法值的精确错误消息, 全部通过.
- H39-H40: 引用前缀使用同一个无状态正则, 两处容器处理保持原样; 隐式目录判断保留 path === '.' 特例, Set 和 Map 路径仍使用相同前缀判断. 既有 Markdown 和文档仓库测试覆盖引用及列表, 缺失目录, 文件与隐式目录分类.
- H41-H43: contextResultFrom 唯一调用方明确传入三个计数; analyzeTerms 的 globalPolicyTrusted 局部判断保留, 只删除未读返回字段. resultFrom 统一复制后排序, 原比较器不变, include 诊断仍按原顺序返回; 既有完整 include 失败集合断言通过.
- `node --test tests/common/json.test.mjs tests/common/markdown-visible-text.test.mjs tests/document-terms/*.test.mjs` 通过, 共 5 个测试文件. `pnpm test` 通过, 共 814 个测试, 0 个失败. 未新增或语义修改测试.
- `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check` 和四个受影响源码的 `node --check` 均通过.
- `node arw.mjs text check`, `node arw.mjs terms check --include .scratch/0022-triage-code-backlog/`, issue 的 language inspect 和 `git diff --check` 通过. 自然语言为中文, 英文部分为精确命令, 路径和标识符.
- 非测试源码新增 30 行, 删除 21 行, 净增 9 行, 满足 10 行预算. 删减自查未发现可继续删除或合并的实现.

## Comments

- 2026-11-01: H38-H43 全部实施, 无跳过项, 不涉及共享导出或公开 Interface 变化, 没有更改 Reviewer 规则或审核语义. 私有 JSON 克隆增加一处已校验嵌套值的 JSDoc 类型断言以通过严格类型检查, 未扩大为类型收窄级联.

- 第 1 轮 Code Standards Reviewer 指出 H40 新数组调用方会额外复制整份清单. Main Agent 独立确认后将私有 helper 改为 for...of 首次匹配即返回, 保留前缀判断和结果, 消除该分配. 定向仓库测试和严格类型检查通过.

- 第 1 轮要求符合 Reviewer 正常完成, 报告为 No problems. H40 修复后第 2 轮两个 Reviewer 均正常完成, 报告均为 No problems. Main Agent 抽查 JSON 公开校验及副本独立性, 回归核对隐式目录的根路径特例, 首次匹配和缺失分类, 未发现漏检. 修复后完整 814 个测试, 类型检查, 受影响文件语法检查, text check 和 terms check 均通过. 第 2 轮之后仅补充本章记录.
