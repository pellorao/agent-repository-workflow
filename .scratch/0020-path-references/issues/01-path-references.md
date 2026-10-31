# 规则文档改用反引号路径引用

Status: completed

## What to build

规则文档里的 Markdown 链接 (`[文字](目标)`) 比同一目标的反引号路径多出链接文字和括号, 每处都额外消耗 token, 也使去重引用的成本高于被引用的文字. 本项把规则文档的引用统一改成反引号路径, 并让分发自包含检查继续机械核对这类引用.

### 新引用语法与检查规则

- 规则文档中的引用写成反引号路径, 可带 `#anchor`. 仓库根相对路径 (以 `docs/agents/`, `.agents/skills/`, `.claude/skills/` 开头) 沿用现有检查. 新增文件相对路径 (两种形式都做机械检查, 书写时取较短者): 以 `./` 或 `../` 开头, 相对所在文件的目录解析, 例如 `../code-review/result-reuse.md#completion-records`.
- 令牌规则: 反引号内的全部内容匹配 `^\.{1,2}/[^\s<>*{}]*\.[A-Za-z0-9]+(#[A-Za-z0-9_-]+)?$` 时才视为文件相对引用: 以 `./` 或 `../` 开头, 以文件扩展名收尾, 可选 ASCII 锚点, 内含空白, 尖括号, 星号, 花括号的一律不匹配. 目标不限于 `.md` 文件 (如 `wizard` 的 `./template.sh`), 转换后原本受检查的每个链接目标仍受机械检查: 范围内的链接都指向带扩展名的文件, 没有指向目录或无扩展名文件的; 指向 `docs/specs/`, `docs/manuals/` 的链接只在不分发的 Source Checkout Skill (`release`, `reviewer-capability`, `upstream-sync`, `platform-standards`) 中, 原本就不在分发载荷检查范围内. 指向目录或无扩展名文件的引用以后如有出现, 保留 Markdown 链接. 理由: 模板占位符和通配 (如 `../<name>/SKILL.md`, `*.md`) 含占位符字符, 不会被误判; 围栏代码块沿用现有规则整体跳过; 当前分发载荷中没有以 `./` 或 `../` 开头的反引号路径. 说明性散文里以反引号写出的不存在示例路径会被判为悬空引用, 这是接受的成本, 写示例时改用围栏或不写 `./` 前缀.
- 解析方式与 Markdown 链接目标相同: 先去掉 `#anchor`, 相对载荷文件的安装路径解析, 再经 `.claude/` 到 `.agents/` 的规范化, 然后用现有的 `resolves` 判断 (载荷内文件, 或目标仓库自有前缀). 诊断码沿用 `distribution-reference-unresolved`. 锚点不校验, 与现有链接检查一致; 锚点仍须是 ASCII.
- 现有 Markdown 链接检查保留不动 (零新增代码): 它仍保护 ARW 自己不转换的内容 (例如上游 Skill 新拉取的文件) 不产生悬空链接. 规则文档不再写 Markdown 链接由 `docs/agents/writing.md` 的规则约束, 不由检查强制.
- 检查范围不变: 只检查载荷 (`baseline/` 与 `skills/`) 的 Markdown. 仅存在于 Source Checkout 的规则文档 (`docs/agents/source-checkout-*.md`, 不进入分发的 Skill 如 `upstream-sync`, `release`, `platform-standards`) 此前就没有链接检查, 现在也没有路径检查, 对等且不是回退.

### Claude Code 投影

Skill 投影只转换 `$name` 引用, 其他字节原样复制, 且 `.agents/skills/<name>/` 与 `.claude/skills/<name>/` 目录深度相同, 文件相对路径在两处解析到同样的相对位置, 因此不需要新增投影处理. 本项以现有的投影一致性检查 (`node scripts/project-claude-skills.mjs --check`) 证明, 并让实施者确认 Platform Adapter 没有改写反引号路径. 反引号内以 `$` 开头的身份终止规则不受影响.

### 转换范围

- 转换: 根 `AGENTS.md`, `docs/agents/**`, `.agents/skills/**` 中全部非 http 的 Markdown 链接 (约 158 处, 不论目标文件类型; 模板中的占位符如 `wayfinder/SKILL.md` 的 `[<已解决的范围内 issue 标题>](链接)` 不是链接, 不改; 链接部分合计约 7000 字符); 随后运行 `node scripts/sync-workflow-distribution.mjs` 与 `node scripts/project-claude-skills.mjs` 重新生成 `distribution/` 和 `.claude/skills/`, 不手改生成副本.
- 不转换: 根 `README.md`, `README.zh-CN.md`, `docs/manuals/`, 面向用户的文档, ADR, 长期规范 (`docs/specs/`), `CONTEXT.md`, `docs/licenses/`, `upstream/` 快照. 这些不是规则文档, 也不在检查范围内.
- 形式选择: 每处引用逐个比较两种形式的字节数 (含 `#anchor`), 取较短者, 相同取仓库根形式. 文件相对形式必须以 `./` 或 `../` 开头 (同目录写 `./x.md`), 比较时按含前缀的实际长度. 一次性转换脚本按此规则计算, 不凭手感.
- 链接文字处理: 文字只是复述目标 (如 `[module-correction.md](...)`) 时整体换成 `` `路径` ``; 文字是描述性短语时, 把描述写进句子, 路径放在反引号里, 句子必须读得通. 同文件内 `[X](#x)` 改为 "X 节" 的普通文字, 不保留锚点. 预计净减约 1900 字符, 逐处手工核对句子通顺, 不批量盲目替换; 一次性转换脚本放在会话临时目录, 完成后删除.
- 上游来源的 Skill (`upstream/sources/*/source.json` 映射到 `.agents/skills/` 的文件) 也转换. 后果: 此后 `upstream-sync` 在这些行上出现本地定制 (`ours-changed`) 的冲突块, 解决时重新转换即可.

### 新写作规则

在 `docs/agents/writing.md` 的 `Minimal sufficient contracts` 一节 (其 "每个事实只保留一个权威来源" 条之后) 增加一条: 规则文档的引用使用反引号路径而不是 Markdown 链接 (指向目录或无扩展名文件时保留 Markdown 链接; 同文件章节写成普通文字 "X 节"); 以 `./` 或 `../` 开头时相对所在文件解析, 否则相对仓库根 (`docs/agents/`, `.agents/skills/`); 两种形式都满足时选字节数更少的一种 (相同时选仓库根形式); 路径可带 ASCII 锚点, 锚点不被机械校验. 同时把 `Source Checkout 分发副本` 一节 "Markdown 链接和 `docs/agents/`, `.agents/skills/` 路径须在分发载荷内解析" 改为包含文件相对路径的措辞; `Repository terminology` 一节 "可以链接到术语表中的定义" 的 "链接" 如指 Markdown 链接则改为路径引用.

### 长期规范

`docs/specs/agent-repository-workflow-development/spec.md` 描述了自包含检查: 第 65 行列出检查对象 (行内链接和反引号路径), 第 487 行说明词法检查的设计理由, 第 527 行列出检查覆盖的测试情境. 三处同步更新: 反引号路径除根相对形式外包含文件相对形式, 给出令牌规则和接受的成本 (说明性散文里的示例路径会被检查), 测试情境增加文件相对路径的可解析, 悬空和不匹配令牌.

### 体积预算

- 非测试代码: 预计净增 4 行 (一个令牌正则常量, 一个循环), 预算上限 8 行; 超出一倍 (16 行) 须停下说明.
- 文档 (按字符): 链接转换预计净减约 1900 字符; `writing.md` 新规则与 spec 三处更新预计增加约 600 字符. 预算: 文档净增量不超过 0 字符 (预计约 -1300); 测试不计入.

### 预期验证与边界情况

- 新增测试 (分发检查的内存载荷风格): 仓库根形式与文件相对形式各自解析成功, 悬空时各自报错; 文件相对令牌解析成功 (同目录, `../` 跨 Skill, 跨到 `docs/agents/`); 指向不存在文件时给出 `distribution-reference-unresolved`; `.claude/skills` 路径经规范化; 围栏代码内的令牌被跳过; 不匹配令牌 (`./x` 无扩展名, `../<name>/SKILL.md`, `*.md`, 带空格) 不产生诊断; 带 `#anchor` 的令牌只校验路径部分. 测试遵循 `test-performance-optimization` Skill, 优先内存载荷, 不新增真实进程测试.
- 完整验证: `pnpm test`, `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `arw text check`, `arw terms check`, 受影响文件的 `node --check`, `git diff --check`. 转换后 `grep` 确认范围内无残留的非 http Markdown 链接 (`](` 后非 http 目标), 并用一次性脚本核对每个新路径指向真实文件.
- 转换会改动 Reviewer 角色文件中的链接写法. 这属于 "改为引用, 不改变任何规则含义" 的改动, 按 `AGENTS.md` 不做 Reviewer 能力测试; 实施者须逐处确认含义未变.
- 边界: 同一行多个链接; 链接目标含 `<...>` 或带标题; 链接出现在表格单元; 链接文字含反引号; 相邻文字已有标点导致句子断裂; 锚点包含非 ASCII 字符 (本仓库要求 ASCII, 如发现违规则报告).
- Spec Readiness 适用 (新增检查行为和公共写作规则), 实施前由 Main Agent 安排.

范围决定: 上游来源 Skill 同样转换; Source Checkout 专用规则文档不增加检查; 锚点不校验.

## Acceptance criteria

- [x] 分发自包含检查解析并核对满足令牌规则的文件相对反引号路径, 悬空时报 `distribution-reference-unresolved`, 代码示例和占位符不被误判; Markdown 链接检查保持不变.
- [x] 范围内规则文档 (根 `AGENTS.md`, `docs/agents/**`, `.agents/skills/**`) 不再含非 http 的 Markdown 链接 (模板占位符除外), 句子读得通, 所有新路径指向真实文件且每处取两种形式中较短者; `distribution/` 与 `.claude/skills/` 由生成脚本重新生成并通过一致性检查.
- [x] `docs/agents/writing.md` 含新的引用写作规则, 分发副本一节措辞同步; 长期规范三处同步更新.
- [x] `pnpm test`, `pnpm typecheck` 与三项分发和生成检查通过; 非测试代码 (`lib/`, `scripts/` 下非 `tests/` 文件) 相对实施开始前的 `HEAD` (`git diff --numstat <起点提交>`, 起点提交记入 `## Validation`) 新增减删除净增不超过 8 行; 文档 (`AGENTS.md`, `docs/**`, `.agents/skills/**`, 不含生成的 `distribution/` 与 `.claude/skills/`) 按同一基线 `git diff <起点提交>` 中新增行减删除行的 Unicode 码点数净增不超过 0.

## Blocked by

- None - can start immediately

## Validation

- 起点提交: 229b47c.
- 实现: `lib/workflow-distribution/workflow-distribution.mjs` 新增 `FILE_RELATIVE_TOKEN` 常量和一个循环, `git diff --numstat 229b47c` 为 +6 -1 (净增 5 行; 审核第 1 轮修复后) (预算 8).
- 测试: 新增 2 个内存载荷测试 (解析与悬空, 不匹配令牌), 回调 0.12 ms 和 0.05 ms, 远低于 100 ms. `node --test tests/workflow-distribution/workflow-distribution.test.mjs` 27 项通过.
- 转换: 135 处文件链接转为反引号路径 (按两种形式取较短者), 另 17 处同文件锚点链接改写为 "X 节" 文字, 全部指向真实文件 (一次性脚本核对 185 个路径令牌, 0 悬空, 脚本已删除). 残留: `wayfinder/SKILL.md` 的模板占位符 `[<已解决...>](链接)` 与 `domain-modeling/CONTEXT-FORMAT.md` 围栏内的示例链接, 均不是链接.
- 文档净增 (`git diff 229b47c -U0 -- AGENTS.md docs .agents` 新增减删除的 Unicode 码点, 不含换行): +23890 -25753 = -1863 (预算不超过 0).
- `pnpm typecheck`, `arw text check`, `arw terms check`, `git diff --check` 通过; `node scripts/check-workflow-distribution.mjs` 通过 (对未重新生成的 `distribution/`).
- `pnpm test`: 812 项中 811 通过, 唯一失败是 `.claude/skills/` 投影一致性 (与 `node scripts/project-claude-skills.mjs --check` 的 stale 一致), 待 Main 同步 `distribution/` 并重新投影后复测; `generate-install-arw --check` 与重新生成后的分发和投影检查待 Main.

- Main 暂存后运行 `node scripts/sync-workflow-distribution.mjs` 与 `node scripts/project-claude-skills.mjs` 重新生成; `pnpm test` 812 通过 0 失败, `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `arw text check` 均通过.

## Comments

Main Agent 10-31 按自主模式决定 (用户要求规则文档统一改用路径引用): 上游来源 Skill 同样转换, `upstream-sync` 的冲突按机械方式解决; 不为 Source Checkout 专用规则文档补检查; 不校验锚点. 决定已写入 `## What to build`.
