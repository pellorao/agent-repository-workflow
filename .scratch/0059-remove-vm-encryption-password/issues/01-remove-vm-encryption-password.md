# 删除 release VM 配置对 VMware 加密密码的支持

Status: completed

## What to build

维护者 2026-11-03 已去掉受验 Windows 11 VM 的加密 (移除虚拟 TPM), 维护者私有 VM 配置里的 `vmwareEncryptionPassword` 字段也已删除, 此后没有任何配置使用它. 删除这项不再有使用者的支持, 不改变其他行为:

- `scripts/release-vm.mjs`: 删除 `Machine` 类型中的 `vmwareEncryptionPassword` 字段, `vmrun` 辅助函数不再有条件地插入 `-vp <密码>`, 只传 `-T ws` 和调用方参数.
- `.agents/skills/release/references/vm.md`: 删除配置示例中的 `vmwareEncryptionPassword` 行, 共用机器文件说明中的该字段名, 以及说明该字段用法的整条要点; 运行 `node scripts/project-claude-skills.mjs` 更新 `.claude/skills/` 投影. `distribution/` 中没有该文档的副本.
- `tests/release/release-vm.test.mjs`: 测试用机器配置不再含该字段. 含秘密的损坏共用文件用例保留, 继续证明错误输出不回显文件内容.

不改动的内容: 已提交的 ADR 0039, 0047 的 spec 与 issue 中提到共用文件含秘密的措辞 (配置里仍有 `guestPasswords` 这类秘密键, 措辞继续成立), 以及行为与此无关的其他配置键.

体积预算: 非测试代码净增不超过 0 行 (预计 -3 行); 测试与文档不计入.

预期验证: `pnpm test`, `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `node arw.mjs text check`, `node arw.mjs terms check --include .scratch/0059-remove-vm-encryption-password/`, `git diff --check`; `grep -rn vmwareEncryptionPassword` 在 `scripts/`, `tests/`, `.agents/`, `.claude/`, `distribution/`, `docs/` 下无匹配.

## Acceptance criteria

- [x] `scripts/release-vm.mjs` 不再含 `vmwareEncryptionPassword` 或 `-vp`; `vmrun` 调用的参数以 `-T ws` 开头, 其后是调用方参数.
- [x] `.agents/skills/release/references/vm.md` 与其 `.claude/skills/` 投影不再提到该字段或 `vmrun -vp`; `node scripts/project-claude-skills.mjs --check` 通过.
- [x] `tests/release/release-vm.test.mjs` 的机器配置不含该字段, `pnpm test` 通过 (现有 release-vm 用例全部保留并通过, 新增或修改的回调耗时低于 100 毫秒).
- [x] 上述预期验证命令全部退出码 0, 且 `grep` 在指定目录无匹配.

## Blocked by

- None - can start immediately

## Validation

- 验收 1: `scripts/release-vm.mjs` 的 `vmrun` 辅助函数现在是 `run(machine.vmrun, ['-T', 'ws', ...args], {quiet: true})`, `Machine` 类型不含该字段; `grep -rn "vmwareEncryptionPassword\|'-vp'"` 在 `scripts/`, `tests/`, `.agents/`, `.claude/`, `distribution/`, `docs/` 下无匹配.
- 验收 2: `.agents/skills/release/references/vm.md` 删除示例行, 字段名和整条要点, `.claude/skills/` 投影由 `node scripts/project-claude-skills.mjs` 重新生成; `--check` 退出码 0.
- 验收 3: `tests/release/release-vm.test.mjs` 仅去掉机器配置中的该字段, 8 个用例全部保留并通过, 单个回调最长 61.96 毫秒.
- 验收 4: `pnpm test` 870 项通过, 0 失败; `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `node --check scripts/release-vm.mjs`, `node arw.mjs text check`, `node arw.mjs terms check --include .scratch/0059-remove-vm-encryption-password/`, `git diff --check` 均退出码 0.
- 体积: 非测试代码 `scripts/release-vm.mjs` 加 2 行, 减 4 行, 净 -2 行, 低于预算 0; 文档 `references/vm.md` 减 3 行 (两份投影各一); 测试改 1 行.

## Comments

- 不含设计决定的清理类单 issue effort, 按维护者 2026-11-02 的常设确认记录 Spec Readiness 例外 (`not-applicable`), 未运行就绪审核.
- `distribution/` 没有 `references/vm.md` 的副本, 无需同步.
