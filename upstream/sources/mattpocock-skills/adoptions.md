# mattpocock-skills 采用记录

按 `$upstream-sync` Skill 追加. 每节记录一次采用: 日期, 旧提交 -> 新提交, 采用, 部分采用和拒绝的内容及原因.

## 391a2701dd948f94f56a39f7533f8eea9a859c87 -> 6acc160e4e0cd062dbbbd7a1b26ae92855edf07e

由旧版 Upstream Sync 引擎完成, 原 Sync Record `sync-records/94cb3aa94a55a4a7adb4886738b519d2de6d8032134c31eef1a8d6dcbf20af67.json` 见 Git 历史.

## 2026-11-03 拒绝 3 个 Skill (提交不变, 仍为 6acc160e4e0cd062dbbbd7a1b26ae92855edf07e)

不经同步, 维护者审定删除下列已采用的 Skill, 并把上游路径加入 `source.json` 的 `exclude`:

- `skills/productivity/handoff/`: 交接作用已由 issue, 台账, 就绪记录等持久记录和平台自带的上下文压缩覆盖.
- `skills/engineering/resolving-merge-conflicts/`: 针对并行分支合并, ARW 的工单在主工作区串行进行.
- `skills/engineering/triage/`: 自带的分诊状态机与 ARW issue 的 Status 和分流标签不一致.
