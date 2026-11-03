# release-vm 读取本地配置文件并支持共用机器文件

Status: completed

## What to build

按 `.scratch/0047-vm-config-split/spec.md` 的 Behavior, Errors 和 Testing 节:

- `scripts/release-vm.mjs`: 命令行去掉位置参数 `<config.json>`, 改为可选 `--config <path>`; 无 `--config` 时读取脚本所在仓库根 (`import.meta.url`) 的 `.arw.local.json` 的 `release` 对象作为 ARW 发布配置, 有 `--config` 时该文件整体是配置 (本地文件只取 `release` 对象). 读取失败按 Errors 节退出 2, 不打印解析器消息. `fixturesDirectory` 与 `sharedMachinesConfig` 的相对路径相对配置所在文件目录 (或绝对). 若有 `sharedMachinesConfig` 则 读取共用文件, 机器条目是共用条目与同键 ARW 条目的浅合并; 机器键两边都没有时沿用 `Machine not found in config`; 顶层键只取 ARW 发布配置. 有效的单文件配置行为不变.
- 根 `.gitignore` 加 `/.arw.local.json`.
- `.agents/skills/release/SKILL.md` 的 VM 命令改为新用法 (`check <machine> <bundle>`, `ssh <machine> <command>`), 并规定先读 `.arw.local.json`, 缺失才问维护者各路径并写入 (只放路径, 不放秘密); 运行 `node scripts/project-claude-skills.mjs` 更新 `.claude/skills/` 投影; 同步 `docs/manuals/development.md` 与 `development.zh-CN.md` 中受影响的 `release-vm` 用法 (如有).
- 修订 `docs/adr/0031-use-github-and-local-validation-sources.md` 中 "VM 配置的职责和格式保持不变" 一句 (改为职责不变, 格式允许拆分, 见 ADR 0039); 新增的 `docs/adr/0039-keep-arw-local-settings-in-a-repository-local-file.md` 已随 spec 写好, 实施时核对其与实现一致.
- 更新 `.agents/skills/release/references/vm.md` (本地配置文件, 拆分格式, 仅含占位符的示例, 合并规则, `--config`, 错误不回显内容) 和 `docs/specs/agent-repository-workflow-release/spec.md` 的 Release validation configuration 节 (已压缩, 指向 Skill 参考).
- `tests/release/release-vm.test.mjs`: 现有测试改用 `--config`, 并增加 spec Testing 节 (a)-(g) 的全部观察 (假命令, 不启动真实 VM).

体积预算: 非测试代码净增约 +25 行.

预期验证: `pnpm typecheck`, `pnpm test`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node arw.mjs text check`, `git diff --check`.

## Acceptance criteria

- [x] spec Testing 节 (a) 拆分配置 (相对与绝对路径引用) 下 `check` 通过且每个 ARW 指定的 Node.js 都被运行; 有测试观察.
- [x] (a0) 相对 `fixturesDirectory` 相对所在配置文件目录解析 (`--config` 与本地文件各一例); 有测试观察.
- [x] (b) ARW 每机键覆盖共用条目, 对象值 (`ssh`) 整体替换; 有测试观察.
- [x] (c) 机器键只在一边时按该边条目运行; 有测试观察.
- [x] (d) 共用文件中的顶层键和 `sharedMachinesConfig` 被忽略; 有测试观察.
- [x] (e) `--config` 文件缺失, 非 JSON 或是目录 (EISDIR), 共用文件缺失, 非 JSON, `sharedMachinesConfig` 非字符串, 机器键两边都没有, 都退出 2, 且 stderr 不含共用文件中的秘密值; 有测试观察.
- [x] (f) 现有测试改用 `--config` 后通过.
- [x] (g) 无 `--config` 时读取 `.arw.local.json` 的 `release`, `--config` 优先, 本地文件不存在或无 `release` 对象时输出 `No release config`, 非 JSON 或是目录时输出 `Config file is not readable JSON`, 都退出 2 且消息不含文件内容 (测试把脚本复制到临时仓库根运行), `.gitignore` 含 `/.arw.local.json`; 有测试观察.
- [x] `$release` Skill 先读本地配置文件再询问维护者, 命令用新用法 (审核核对文字).
- [x] `references/vm.md`, 发布 spec 的配置一节和 ADR 0031 已更新, ADR 0039 与实现一致, 示例只含占位符.
- [x] 上述验证命令全部退出码 0 (测试观察: `pnpm test` 通过).

## Blocked by

- None - can start immediately

## Validation

- `pnpm typecheck`: 通过.
- `pnpm test`: 通过 (全部测试, 0 失败; 新增测试各自耗时低于 100 毫秒).
- `node scripts/check-workflow-distribution.mjs`: 通过.
- `node scripts/project-claude-skills.mjs --check`: 通过 (退出码 0).
- `node arw.mjs text check`: 通过.
- `git diff --check`: 无输出.
- `node arw.mjs spec-readiness verify --issue issue:0047:01 --subject-only`: 退出码 0.

## Comments

- 台账: docs/adr/0039 冲突裁决 0038 已分配给并行 effort 0046, 由紧随本提交的 0046 提交补上, 历史不留空号.
- 提交审核第 1 轮处置: 三处中文 H3 改英文并重新投影; 配置顶层不是对象 (含 `null`) 按 spec 退出 2, 本地 `release` 非对象报 `No release config`; 测试补区分度 (`--config` 用例的工作目录不同于配置目录, `ssh` 整体替换断言共用字段不出现, `minimum` 运行).
- 第 2 轮处置: 顶层数组同样判为不是对象并补测试; 合并 `shared` 的声明与 if, 失败文本只保留一处; 删除 `lib/` 导入和测试里的符号链接.
- 台账: scripts/release-vm.mjs 冲突裁决 第 1 轮建议复用 lib/common/json.mjs 与 spec/ADR 0039 的单文件要求冲突, 按 spec 保持单文件, 用 fatal TextDecoder 保留拒绝非法 UTF-8 的行为.
- 体积: `git diff --cached --numstat` 显示 `scripts/release-vm.mjs` +40/-19 (净 +21), `.gitignore` +3, 非测试代码净增 +24, 在预算 25 之内, 无需超出说明.
- 第 3 轮处置: `release` 是数组时同样报 `No release config` 并补测试.
- 台账: scripts/release-vm.mjs:47 记录不修 TextDecoder 默认剥离 UTF-8 BOM, 带 BOM 的配置被接受; 方便 Windows 编辑器保存的文件, 不影响其他错误分支
- 完成记录 (11-03 补, 实施已在 `f851b16` 提交): 补记审核第 1 轮要求符合审核指出 `spec.md:20` 与本 issue 的 `check` 用法缺 `--archive <arw.tar.gz>`; 该参数由后续 effort 0049 加入, 不是本次变更引入, 按 Triage by origin 不阻断, `spec.md:20` 另以非实施提交补齐, issue 文字保留 0047 交付时的用法.
