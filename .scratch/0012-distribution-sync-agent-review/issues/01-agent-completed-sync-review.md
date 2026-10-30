# 发布前同步改由 Agent 完成引用审核与 apply 授权

Status: completed

## What to build

按用户 2026-10-30 的决定, 实现 [spec:0012](../spec.md) 的 Behavior: 去掉 `scripts/sync-workflow-distribution.mjs` 引用审核的编辑器步骤和 `review --confirm`, 新增 `review --complete`, 并去掉 `apply` 前的用户 `planDigest` 授权. 涉及 `scripts/sync-workflow-distribution.mjs` 与 `lib/workflow-distribution/skill-reference-review.mjs`; 删除只为编辑器审核存在的代码和测试 (`reviewEditor` 配置字段除外, 见下段).

引用审核不再读取 `reviewEditor`; 该配置字段及其安装, 校验和测试保持不变, 不升级 `configVersion`.

新增 `docs/adr/0034-*.md` 记录授权主体变化, 并在 ADR-0026 的对应句处指向它 (见 spec:0012 ADR Evaluation). 同步更新长期文档使之与新行为一致, 每个事实只在拥有它的文档中陈述: `docs/specs/agent-repository-workflow-development/spec.md` 的 Human review 一节, Entry point and lifecycle 的封闭调用与第 3 步, 重建范围段中 "只接受一次用户授权", 引用审核与 `apply(...)` 的 Interface 段, `## 设计理由` 中描述用户删除列表与用户选择的两段, `Dependencies and Data Flow` 权威来源表中全局配置, 审核文件和计划授权三行, `Module Design Rationale` 中相应理由, 以及 ADR Evaluation 中引用 ADR-0026 用户审核的两句; `docs/specs/agent-repository-workflow-installation/spec.md` 中说明 `reviewEditor` 用途的句子改为说明它当前无使用者, 保留到下次配置版本升级; 其他提及编辑器引用审核或用户批准 `planDigest` 的 spec 与 `docs/manuals/**` 中英文手册. 只改与本行为相关的句子, 不改其他合同.

验证: `pnpm test`, `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `node arw.mjs text check`, `node arw.mjs terms check --include .scratch/0012-distribution-sync-agent-review/`, `git diff --check`. 测试覆盖 `review` 输出路径且不启动编辑器, 读取的 Git 路径有未暂存或未跟踪内容时返回 `blocked` 且零写入, 候选写入失败返回 `failed`; `--complete` 接受删除式编辑与未变化文件并写入 `completed-review.json`, 拒绝新增, 改写或重排的行, 无效 JSONL, 身份不在允许集合的第二份文件行和缺少原始候选, 文件读取或结果写入失败返回 `failed`; `review --confirm` 为用法错误. 开发长期规格 `## Validation strategy` 补充引用审核入口的上述覆盖. 新增或语义修改测试后按 `test-performance-optimization` Skill 测量回调耗时. 不运行真实 apply 同步, 不安装, 不推送, 不修改 `lib/background-agent/**`.

预估非测试代码净增约 -40 行 (删除编辑器启动与确认分支, 新增完成校验); 文档净增约 1500 字符 (含新 ADR).

## Acceptance criteria

- [x] `review` 只写两份完整候选文件并输出路径, 不读取 `reviewEditor`, 不启动进程; `review --confirm` 不再是合法调用, 用法错误退出 2. 观察: 入口代码与脚本测试.
- [x] `review --complete` 对删除式编辑和未变化文件成功并写入 `completed-review.json`, 对非删除式编辑, 无效 JSONL 和身份不在允许集合的行返回 `blocked` 且不改写文件; `prepare` 能读取其结果. 观察: 测试.
- [x] `apply --plan-digest` 的绑定校验行为不变; 长期文档不再要求用户批准 `planDigest` 或通过编辑器审核, 改为调用 Agent 判断与确认. 观察: 文档差异.
- [x] 新 ADR 0034 记录授权主体变化, ADR-0026 与开发长期规格的 ADR Evaluation 指向它; `reviewEditor` 配置行为不变, 安装规格注明当前无使用者. 观察: 文档差异.
- [x] 完整验证命令通过. 观察: Validation 的实际命令结果.

## Blocked by

- None - can start immediately

## Validation

- 实现: `scripts/sync-workflow-distribution.mjs`, `lib/workflow-distribution/skill-reference-review.mjs`; 测试: `tests/workflow-distribution/skill-reference-review.test.mjs`, `tests/workflow-distribution/sync-workflow-distribution-script.test.mjs`. 非测试代码净增约 -155 行, 低于预估 -40 行, 因编辑器启动, 确认分支, 配置读取和 `lib/arw-common/editor-process.mjs` 只为引用审核存在的等待模式整段删除 (`lib/arw.mjs` 的 `arw open` 调用随之去掉 `wait: false`).
- 文档: 开发长期规格 (Human review 改名 Reference review, 生命周期, Interface, 设计理由, 权威来源表, Module Design Rationale, ADR Evaluation, Validation strategy), 安装规格与总长期规格中 `reviewEditor` 的用途句, `docs/manuals/development.md` 与中文版, ADR-0026 指向句, 新增 `docs/adr/0034-let-the-main-agent-complete-distribution-sync-review.md`.
- 测试覆盖: `review` 写两份完整候选并返回路径, 不启动编辑器; `--confirm` 为用法错误退出 2; `--complete` 接受删除式编辑与未变化文件, 拒绝插入, 改写, 重排, 无效 JSONL, 未终止文件, 已删除额外身份的第二份文件行和未先 `review`, 读取失败返回 `failed` (`review-read`); CLI 测试串联 `review`, `--complete`, `prepare`, `apply`.
- 提交审核第 1 轮修正后: `pnpm test`: 803 个测试, 803 通过, 0 失败; 新增 `completed-review.json` 写入失败时返回 `failed` 且不输出哈希的测试; `pnpm typecheck` 通过; 三个生产检查脚本, `node arw.mjs text check`, 本 effort 的 terms check 和 `git diff --check` 通过. 新增或修改测试最慢回调约 16.3 毫秒.
- `config.mjs`, `config.install.json` 与配置测试未改. 未运行真实同步, 未安装, 未修改 `lib/background-agent/**`.

## Comments

- Spec Readiness 共 6 轮: 前 5 轮依次补完整 Module Design, ADR 0034, 保留 `reviewEditor` 的兼容理由, I/O 与 `blocked` 测试边界和逐行判断的责任方, 第 6 轮 No problems..
- 实施偏离: `review --complete` 不保存原始候选副本, 而是按 `review` 的同一规则从当前 Git 输入重新计算, 与 `prepare` 一致; 输入变化即删除式校验失败. 已据此更新 spec:0012 Interfaces 的措辞, 行为边界 (缺失时 `blocked`, 变化时拒绝) 不变, 不改 subject.
- 提交审核第 2 轮: 要求符合 No problems.; Code Standards 指出 `writeReviewFile` 对常量路径的解析与抛出不可达, 已删除, 路径改由调用处按工作区拼接, 测试桩去掉 `resolve`; 修正后 `pnpm test` 803 通过, `pnpm typecheck`, 三个生产检查脚本, text check 与 `git diff --check` 通过.
- 台账: lib/workflow-distribution/skill-reference-review.mjs:267 记录不修 提交审核第 3 轮 Code Standards 建议改回 `filesystem.resolve` 取路径, 与第 1, 2 轮要求删除该解析的结论相反; 第 3 轮起只修行为缺陷, 此项不影响行为 (路径由同一绝对工作区与常量文件名拼接), 保留现状.
