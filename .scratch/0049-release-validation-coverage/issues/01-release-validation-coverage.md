# 发布验证按操作系统补齐覆盖

Status: completed

## What to build

按 `.scratch/0049-release-validation-coverage/spec.md` 的 Behavior 与 Testing 节:

- `docs/specs/agent-repository-workflow-release/spec.md`: 新增 `## Validation coverage` 节 (规则加六类表格, 内容见 effort spec 的 "长期规范的新节", 六个被排除的环境情形, 降级与真实目标仓库矩阵, 初始化 issue 生命周期写入 "不属于发布门禁" 并各附理由); `## Release procedure` 第 3 步与第 6 步, `## Design rationale` 的 VM 验证段按 effort spec 的 "发布规范其他段落" 改写.
- `docs/agents/source-checkout-validation.md` 中 Windows PATH 一段的 Explorer 一句改为与实际一致.
- `.agents/skills/release/SKILL.md` 第 3 节开头, 第 2 步 (打包), 第 3 步 (`--archive`) 和宿主 Agent CLI 检查一步; `references/publication.md` 的公开 Bootstrap 验证增加不带 `--version` 的一次; `references/vm.md` 的 WSL 示例加 `--archive`; 运行 `node scripts/project-claude-skills.mjs` 更新 `.claude/skills/` 投影.
- `scripts/release-guest-check.mjs`: 新增必选 `--archive`, 并按 effort spec 的 "guest 检查" 第 1 到 13 步补齐 (含 Windows 的 `arw.cmd` 参数传递步骤和含空格与非 ASCII 用户目录的嵌套重跑); 全部情形的实现位置以该节为准. 同时修复该脚本当前的 `pnpm typecheck` 报错.
- `scripts/release-vm.mjs`: `check` 增加必选 `--archive`, 传入客户机并转交 guest 检查.
- `tests/release/release-vm.test.mjs`: 按 Testing 节更新和新增用例.

体积预算: 计数口径是这两个脚本文件的 `git diff --numstat` 新增行减删除行 (含被替换的旧代码: guest 自己打包候选的步骤被删除; 测试与文档不计); `scripts/release-guest-check.mjs` 净增不超过 +110, `scripts/release-vm.mjs` 净增不超过 +10. 超出时先削减, 无法再削减则继续完成并在 `## Comments` 写明超出量和原因, 不视为未完成.

预期验证: `node --test tests/release/release-vm.test.mjs`; 宿主 Linux 在临时 HOME 下本地运行 guest 检查 (带与不带 `--previous`); Windows PowerShell 片段只做语法解析; `pnpm typecheck`, `pnpm test`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `node arw.mjs text check`, `node arw.mjs terms check --strict`, `node arw.mjs language inspect` 新改文档, `git diff --check`.

## Acceptance criteria

- [x] 发布 spec 含 `## Validation coverage` 节: 规则一段, 六类表格 (每台, 仅 Windows, 仅 Linux, 宿主一次, 固定测试, 不属于发布门禁), "不属于发布门禁" 表的八行各有一句理由; 第 3 步, 第 6 步和 Design rationale 引用该节 (审核核对文字).
- [x] `docs/agents/source-checkout-validation.md` 不再声称从 Explorer 启动新 PowerShell 进程 (审核核对文字).
- [x] release Skill 及其 `references/` 含 `--archive` 打包与传入, 宿主 Agent CLI 检查和不带 `--version` 的公开 Bootstrap 验证, `.claude/skills/` 投影与之一致 (`project-claude-skills.mjs --check` 退出码 0).
- [x] `release-vm.mjs check` 缺 `--archive` 或没有值时退出 2 并提示 `--archive <arw.tar.gz> is required`; 有测试观察. 提供时 `scp` 参数含压缩包, guest 命令含 `--archive arw-archive.tar.gz`; 有测试观察.
- [x] guest 检查在宿主 Linux 临时 HOME 下带与不带 `--previous` 各运行一次 (含嵌套的含空格和非 ASCII 的 `HOME`), 都以 `PASS` 结束, 运行后无残留进程 (记入 `## Validation`).
- [x] `pnpm typecheck` 对 `scripts/release-guest-check.mjs` 通过; 两个脚本的净增行数在预算内或已在 `## Comments` 说明 (`git diff --numstat` 输出核对).
- [x] guest 检查中的每个 Windows PowerShell 片段通过 PowerShell 语法解析 (不执行, 记入 `## Validation`).
- [x] 上述验证命令全部退出码 0 (命令输出核对, 测试观察: `pnpm test` 通过).

## Blocked by

None.

## Validation

- `pnpm test` 859 通过 / 0 失败; `pnpm typecheck` (含修复的 `release-guest-check.mjs` 报错), `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `node arw.mjs text check`, `node arw.mjs terms check --strict`, `git diff --check` 通过; `node arw.mjs language inspect` 新改的 5 份文档均以中文为主 (79.9% 至 85.9%). `node --test tests/release/release-vm.test.mjs` 8/8 通过.
- 本地 Linux 运行 guest 检查 (`env -i` 临时 HOME, 压缩包由 `pack-release.mjs` 为当前工作树打成, 约 0.46 MB): 不带 `--previous` 与带 `--previous 6a5353468bbc9792d5df0f5594109da84ae20bfb` (0.5.1) 各一次, 都以 `PASS linux node 24.22.1 0.5.2` 结束, 其中含第 13 步嵌套的名为 `用户 home` 的 HOME 重跑 (同样 PASS), 运行后无残留进程. 两次合计写盘约几十 MB, 已删除.
- Windows PowerShell 片段 (PATH 写入, 类型与条目检查, Installation 条目计数, 删除值, 解析 Machine 加 User PATH, `Get-Command arw`, `arw language inspect`) 经 `powershell.exe` 的 `Parser::ParseInput` 语法解析全部通过, 未执行.
- `arw language inspect 'a b,c&d.md'` 在 Linux 上原样列出含空格, 逗号和 & 的文件名 (第 12 步依据).
- 没有连接 VM; Windows 步骤 (bsdtar 与 GNU tar 双次 Bootstrap, ExpandString, `arw.cmd` 参数, Git Bash) 留到下次发布的真实 VM 验证.

## Comments

- 预算 (`git diff --numstat`): `scripts/release-guest-check.mjs` +127/-28 = 净增 99 (预算 110); `scripts/release-vm.mjs` +13/-4 = 净增 9 (预算 10). 均在预算内.
- guest 第 6 步按实现行为验证 (`validateRemovalChoices`): 产品 spec 没写明哪些 remove 选择类别必填, 缺口由 Main 另立 issue (状态页 ARW/rmspec), 本 issue 不改产品 spec.
- 就绪审核共 4 轮, 通过于第 4 轮. 原型代码曾在就绪通过之前写入工作区 (已按 Main 指示保留并在通过后按定稿 spec 核对补全).
- 提交审核第 1 轮 10 条全部修复, 没有不修的条目: 引用路径与重复清单 (source-checkout-validation, release Skill), 固定测试表按情境重写, Design rationale 去掉对旧机制的叙述, 发布 spec 第 6 步补引用, guest 脚本两处立即调用箭头函数拆成语句, 去掉 `SystemRoot` 回退, Windows 步骤 2 改用默认 `tar` (与 spec 一致), `--archive` 的值以 `--` 开头时按用法错误退出 2 并补测试. 与审核无关的 vm.md 第 68 行限制没有改动 (转入后续 issue ARW/vmbase 的范围).
- 重跑: `pnpm test` 859 通过, `pnpm typecheck` 通过, `release-vm` 测试 8/8; 本地 Linux guest 检查带与不带 `--previous` 各再通过一次 (含嵌套). 另有一次不带 `--previous` 的运行在嵌套阶段 `启动后台管理进程` 报 `Background Agent credential is invalid.`, 未复现 (其后连续两次通过), 原因未查明; 失败留下的临时安装已按产品卸载路径清理 (`uninstall.mjs --stop-background-agents true`). 下次发布 VM 验证若再现, 另行跟踪.
