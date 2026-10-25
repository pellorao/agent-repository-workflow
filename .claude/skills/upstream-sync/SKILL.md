---
name: upstream-sync
description: 仅在维护者显式调用时, 在 ARW 源码仓库中把上游 Skill 来源 (如 mattpocock-skills) 的新版本经维护者逐批审核后采用到 `.agents/skills/`, 并记录采用结果.
disable-model-invocation: true
---

# Upstream Sync

只有维护者在 ARW Source Checkout 中显式调用本 Skill 时才使用. 它不进入 Workflow Distribution, 也不是 `arw workflow update`. 目标: 维护者看清上游旧快照 (Base), 上游新版本 (Theirs) 和本地当前 Skill (Ours) 的三方差异, 决定采用哪些变化, 采用结果有记录.

来源配置在 `upstream/sources/<source>/source.json`: `url`, 已采用的固定提交 `commit`, 上游路径到本地路径的 `map` (以 `/` 结尾的键按前缀匹配, 其余精确匹配) 和优先的 `exclude`. 采用记录追加在同目录的 `adoptions.md`.

## 1. 确定目标提交

1. 维护者没有指定提交时, 用 `git ls-remote <url> HEAD` 取得上游当前提交, 向维护者确认这个完整 40 位提交 ID.
2. 确认工作树中 `.agents/skills/`, `.claude/skills/` 和 `docs/licenses/arw/` 没有未提交的改动, 以免混入同步结果.

## 2. 生成三方视图

运行 `node scripts/upstream-sync.mjs <source> <commit>`. 脚本取得 Base 与 Theirs, 先打印范围内的上游提交日志, 然后每个上游变化一行: `<A|M|D|R>`, Ours 状态, 本地路径 (改名时附 `(from <旧本地路径>)`, Ours 取旧路径). 改出映射范围的路径显示为 `D`, 改入的显示为 `A`; 对照提交日志区分上游真删除和移到其他类别 (如 `in-progress`). 快照写入 `.tmp/upstream-sync/<source>/base/` 和 `theirs/`; Ours 有本地改动且两边都有文件时, `git merge-file` 的结果写入 `merged/`, 行内 `conflicts=<n>` 是冲突块数.

按 Ours 状态决定候选:

- `ours=base`: 本地未改, 候选是 Theirs (删除时候选是删除).
- `ours=theirs`: 已一致, 不处理.
- `ours-changed`: 本地有定制. 以 `merged/` 为起点, 逐个解决冲突块; 没有冲突的合并也要检查语义. 改名 (`R`) 时候选写到新路径并删除旧路径. 上游删除了本地定制过的文件时, 和维护者确认是否删除.
- `A` 而状态不是 `ours-missing`: 上游新文件与 ARW 自有文件重名 (如上游新 Skill 与 `release`, `commit` 同名). 不要合并, 先问维护者, 通常把该上游路径加入 `exclude`.
- `ours-missing`: 本地删除过或是上游新文件. 新 Skill 或新文件询问维护者是否采用; 不采用的路径加入 `exclude`.

`agents/openai.yaml` 是本地 Codex 元数据, 上游也可能提供. 合并时保留本地的 `policy`, 采纳上游对显示文字的修改.

## 3. 改写为 ARW 格式

采用的 Markdown 内容按 ARW 统一来源格式改写:

- Skill 引用写成 Codex 形式 `$name`. 上游的 `/name` 和 "Call the Skill tool with ..." 等 Claude Code 写法都要转换; 引用的不是 Skill (路径, URL, 命令) 时保持原样.
- 保留本地定制的含义和措辞 (中文内容, ARW 术语, 已删除的段落不复活), 除非维护者决定采用上游写法.
- 许可证文件只能逐字节采用 Theirs, 不可合并. 许可证有变化时单独提交维护者处理.

## 4. 逐批审核并应用

按语义分批 (通常一个 Skill 一批; 改名算一批; 跨 Skill 的同一种改动可合为一批). 每批:

1. 用普通语言说明上游改了什么, 本地定制是什么, 打算如何合并. 未决的重要语义选择用 `/grilling` 与维护者达成共识.
2. 把候选写入 `.agents/skills/` (或映射的目标路径), 给出 `git diff -- <本批路径>` 供维护者审核.
3. 维护者批准后才进入下一批. 已批准路径之后又被修改时, 重新审核该批.

维护者拒绝的变化不写入; 拒绝整个文件或 Skill 时, 把上游路径加入 `exclude`.

## 5. 记录并提交

全部批次批准后:

1. 把 `source.json` 的 `commit` 改为目标提交.
2. 在 `adoptions.md` 末尾追加一节: 日期, 旧提交 -> 新提交, 采用, 部分采用和拒绝的 Skill 或路径及原因.
3. 运行 `node scripts/project-claude-skills.mjs`, `node scripts/check-workflow-distribution.mjs` 和 `pnpm test`. 采用的变化要进入发布时, 另外按 [开发手册](../../../docs/manuals/development.zh-CN.md) 的发布前同步路线运行 `node scripts/sync-workflow-distribution.mjs` 的各子命令.
4. 维护者确认最终 `git diff` 后, 提交 `.agents/skills/`, `.claude/skills/`, 许可证, `source.json` 和 `adoptions.md`, 提交说明写明来源和新旧提交.

中途放弃时, 用 `git restore` 还原已写入的路径即可; `.tmp/upstream-sync/` 可随时删除.
