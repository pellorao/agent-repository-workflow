# 检出为 CRLF 的仓库读取时归一化换行

Status: completed

## What to build

问题: 仓库被检出成 CRLF (Windows 上 Git 默认 `core.autocrlf=true`) 后, 锁文件规范 JSON 逐字节比较失败, 被当成未初始化 (`workflow-uninitialized`); 即使通过, 受管内容哈希和 update 计划也按原始字节比较, 报漂移或每次重写全部受管文件.

改动 (Main 已定方案 b): 在 Repository Workflow 的两个文件系统读取适配器 (`createNodeRepositoryFilesystem` 与 Code Map 的适配器) 的 `readBytes` 和 `readFrontmatterBytes` 中 (`.toml` 文件除外, 见下), 用 `lib/common/text-policy.mjs` 新增的共享函数 `readManagedBytes(path, bytes)` 在字节层 (不解码) 把 CRLF 和单独的 CR 换成 LF, 无 CR 时原样返回; `.toml` 例外也由该函数统一判定, 三处读取共用. 所有读取方 (状态观察, 计划, 事务预检和重验) 因而共用同一份归一化结果, 写入本来就是 LF. `.toml` 文件 (Codex 配置含用户字节, 现有测试要求原样保留) 读取时不归一化, 因为用户配置不属于受管内容. Main 的产品决定 (提交审核第 1 轮): 比较处处忽略换行, ARW 只写 LF; 因此 (a) init 采用只差换行符的目标; (b) ARW 改写文件时整个文件写成 LF, 含仓库自有文本. 规范 `docs/specs/agent-repository-workflow/spec.md` 的采用, 区域替换, 换行规则三处和 `docs/adr/0002-use-repository-local-managed-distribution.md` 的采用句同步改写. 不写 `.gitattributes`, 不改 `arw text check` 对 CRLF 的报告.

体积预算 (非测试代码行): 净增约 +8; 上限 +15. 文档预算 (字符): 约 +330.

预期验证: 测试先初始化并提交, 再把全部受管文件和锁文件改成 CRLF 并再次提交 (模拟 CRLF 检出, 不再需要 `allowDirty`), `workflow verify` 满足, `workflow update` 的计划没有操作 (幂等), 且不写文件. 边界情况: 不含 CR 的字节原样返回, 既有测试不变.

## Acceptance criteria

- [x] CRLF 检出的已初始化仓库 `workflow verify` 通过, `workflow update` 无操作.
- [x] 归一化只在读取时进行, 写入使用 LF, 既有测试不变通过.
- [x] 规范文档说明该行为.

## Blocked by

- None - can start immediately

## Validation

- 验收条件 1: `tests/repository-workflow/workflow.test.mjs` 新测试 "a CRLF checkout verifies and updates like the LF original without rewriting files" 通过 (约 67 ms): 初始化后把锁文件, `.arwignore` 和全部受管文件改成 CRLF, `verify` 为 `{diagnostics: [], satisfied: true}`, `update` 的计划操作为空且文件字节不变; 临时让归一化函数失效时该测试失败.
- 验收条件 2: 其余既有测试不变通过, 含 "Codex configuration lifecycle preserves user bytes ..." (`pnpm test` 831 通过).
- 验收条件 3: `docs/specs/agent-repository-workflow/spec.md` 的采用, 区域替换, 换行规则三处和 ADR 0002 已按 Main 的产品决定更新.
- 体积: 非测试代码约 +9 行 (`lib/common/text-policy.mjs` +3, `code-map.mjs` +2 -1, `workflow.mjs` 约 +5), 在上限 +15 内.
- 全量: `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `arw text check`, `arw terms check --include .scratch/0032-crlf-checkout-normalize/` 通过.

## Comments

- 就绪记录为 `not-applicable` 例外 (用户 2026-11-02 确认无设计决定的单 issue 不需要治理设计). 这个 issue 的例外记录在开始写实现后才生成 (issue 文件与例外记录都在动代码之后), 偏离了 "先生成例外记录再改实现" 的要求, 内容与生成时机无关.
- 设计取舍: `.toml` 不归一化是对 "Codex 配置原样保留用户字节" 的保留; 副作用是 CRLF 检出下 `.codex/agents/*.toml` 的 seed 比较仍按原字节. 若 Main 想要更细的判定 (例如只豁免配置目标), 需要让适配器知道配置路径, 当前没有这样的接口.

- 就绪记录 (`not-applicable` 例外) 在实现改动之后才生成, 与 "首次修改实现文件前取得就绪结果" 的顺序不符. 维护者 2026-11-02 已追认这一偏离.
- 提交审核第 1 轮处理: (1) 归一化改为字节层 (`readManagedBytes`), 不再 UTF-8 解码, 无效 UTF-8 加 CR 仍被判无效, 新增 `tests/common/text-policy.test.mjs` 用例 (含 CRLF, 单独 CR, 无效字节, `.toml`); (2) `.toml` 例外统一进 `readManagedBytes`, `workflow.mjs` 的 `readBytes`, `readFrontmatterBytes` 与 `code-map.mjs` 的 `readBytes` 三处共用, 删除 `readsRawBytes`; (3) Main 的产品决定 (比较忽略换行, ARW 只写 LF, 改写文件时整文件 LF 含仓库自有文本) 记入 What to build, 规格三处和 ADR 0002 一处按此改写, 并写明 `.toml` 按原始字节比较及原因, 删去 "与 LF 仓库结果相同" 的无条件说法; (4) 测试改为先提交再转 CRLF 再提交, 去掉 `allowDirty`.
- 体积更新: 非测试代码 `git diff --numstat HEAD` 三个 lib 文件 +11 -4, 净增 7 行, 在上限 +15 内 (Main 把字节层归一化改为 latin1 逐字节映射, 不解码, 去掉显式循环); 文档约 +700 字符 (规格, ADR).
- 第 2 轮提交审核: (1) `lib/common/text-policy.mjs` 只保留通用的 `normalizeLineEndingBytes`, `.toml` 判定与 `readManagedBytes` 移到 `lib/repository-workflow/code-map.mjs` (`workflow.mjs` 已从它导入, 无新模块); (2) ADR 0002 改为引用规格路径, 不复述细节, 并在所有权段写明换行符例外; (3) Main 决定: 失败回退恢复读到的归一化字节, 内容复原, 换行为 LF, 写入规格换行规则段. `tests/common` 与 `tests/repository-workflow` 85 个通过, `pnpm typecheck` 通过.
