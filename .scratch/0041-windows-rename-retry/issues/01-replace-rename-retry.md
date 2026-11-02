# Windows 上替换文件的 rename 遇到短暂占用时重试

Status: completed

## What to build

issue 0040 的 VM 验证中, Windows 11 从 0.5.1 覆盖安装候选时, 3 次尝试里有 2 次在 `从压缩包安装` 失败: `EPERM: operation not permitted, rename '<home>\.agent-repository-workflow\.manifest.json.arw-tmp-<pid>-<id>' -> '<home>\.agent-repository-workflow\manifest.json'`. 安装器与 0.5.1 相同, 第 3 次通过. Windows 上杀毒软件或索引服务短暂打开刚写入的文件时, 覆盖它的 rename 会报 EPERM, EACCES 或 EBUSY; 用户机器同样会遇到, 安装器不能因此失败.

`lib/common/filesystem.mjs` 的替换写入 (`writeFile` 后 `rename(temporary, target)`) 在 Windows 上遇到 EPERM, EACCES 或 EBUSY 时短暂退避重试, 总等待有上限 (数秒量级), 超过上限仍失败时按原样返回原错误. 其他平台和其他错误码行为不变. 同类的临时文件替换 (`lib/background-agent/recovery-record.mjs`, artifact-migration 的 rename) 由实施者判断是否共用同一重试; 共用时不扩大到无关调用.

体积预算: 非测试代码约 +20 行.

预期验证: `pnpm test`, `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `node arw.mjs text check`, `git diff --check`. 不另跑 VM: 下一次发布验证覆盖 Windows 覆盖安装.

## Acceptance criteria

- [x] Windows 上 rename 先报 EPERM (或 EACCES, EBUSY) 后成功时, 替换写入成功; 持续失败时在上限内返回原错误; 有测试覆盖 (用 mock, 不依赖真实 Windows).
- [x] 非 Windows 平台与其他错误码不重试, 有测试覆盖.
- [x] 上述验证命令通过.

## Blocked by

None.

## Comments

- 净增: 非测试代码 +19 / -1 (净 +18, `lib/common/filesystem.mjs`, 含一行注释), 在 +20 预算内. 重试只用于 Windows 上 EBUSY, EACCES, EPERM, 退避 50, 100, 200, 400, 800, 1600 ms (总等待 3.15 秒), 用尽后原样抛出原错误, 由原有 `file-replace` 失败路径返回.
- 其他 rename 点不共用: `lib/background-agent/recovery-record.mjs` 写的是后台 Agent 运行状态, 位于私有目录且由单一守护进程写入, `lib/artifact-migration/artifact-migration.mjs` 替换的是源码仓库 `.scratch` 内的 issue 文件, 一次性手动升级; 两者都不在安装器路径上, 没有观察到失败, 按 Efficiency First 不为假设的占用扩大范围. 它们若在 Windows 上出现同类失败, 再把 `renameReplacing` 移到共用位置.
- 测试不改生产代码: 通过 `t.mock.method` 替换 `node:fs/promises` 的 `rename` 和 `node:timers/promises` 的 `setTimeout`, 再用 `syncBuiltinESMExports()` 让 ESM 具名绑定生效, 并临时改写 `process.platform`; 生产代码在调用时读取 `process.platform`, 没有为测试添加注入点或真实等待.

## Validation

- `pnpm test` 845 通过 / 0 失败; `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `node arw.mjs text check`, `git diff --check` 通过.
- 新增 3 个测试回调耗时: `node --test tests/common/filesystem.test.mjs` 重复 3 次, Linux 6.18 (WSL2), Node v24.22.1: 重试后成功 2.1 至 2.3 ms, 重试用尽 1.8 ms, 其他平台与其他错误码不重试 4.9 至 5.3 ms, 均低于 100 ms.
- 不另跑 VM, 下一次发布验证覆盖 Windows 覆盖安装.
