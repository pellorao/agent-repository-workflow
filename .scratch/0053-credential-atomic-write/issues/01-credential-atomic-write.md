# 后台管理进程凭据原子写入

Status: completed

## What to build

后台管理进程 (daemon) 用 `open(path,'wx')` 再 `writeFile` 写 `credential`, 空文件在写入完成前短暂可见; 客户端首次启动轮询 (`lib/background-agent/client.mjs` 的 `credential()`) 读到空串就抛 `Background Agent credential is invalid.`, 而轮询的 catch 只重试 `ECONNREFUSED` 和 `ENOENT`, 导致偶发启动失败.

`lib/common/filesystem.mjs` 的 `write` `create-atomic` 分支改为用 `open` 写入临时文件, 先 `sync()` 再 `link()` 发布, 并接受可选 `fileMode` (已定义时对临时文件 `chmod`, 与 `replace` 分支一致, 发布前即为私有); `link()` 的 `EEXIST` (目标在预检查后发布前出现) 返回 `blocked` 与 `filesystem-create-collision`; 无论成功失败, 临时文件都只做尽力清理 (成功发布后的删除失败不使写入失败, 也不覆盖原始失败). `lib/background-agent/daemon.mjs` 的 `privateCredential` 通过 `createScopedFilesystem` 调用它 (`fileMode: 0o600`), 发布成功后调用 `securePrivateStatePath` (Windows ACL; 运行目录本身已是私有目录, 与原先写完再设置的时机相同), 目标已存在 (`filesystem-create-collision`) 时沿用已有凭据, 其他失败照常抛出; 内容非法仍报 `Background Agent credential is invalid.`. Node 的 `fs.link` 在 Windows 上对应 NTFS 硬链接 (`CreateHardLinkW`), 目标已存在时同样报 `EEXIST`. 客户端不改.

体积预算: 非测试代码净增不超过 10 行.

预期验证: `tests/background-agent/daemon.test.mjs` 用 mock 的 `link` 在发布前一刻观察目录: 此时 `credential` 不存在, 临时文件内容完整; 发布成功后无临时文件残留; `link` 失败时无临时文件和凭据残留; 已存在的非法凭据保持原样并报 `credential is invalid`. 另跑 `pnpm typecheck`, `pnpm test`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node arw.mjs text check`, `git diff --check`.

## Acceptance criteria

- [x] 凭据文件出现在 `credential` 路径时内容已完整写入 (测试在 `link` 之前观察到 `credential` 不存在且临时文件为 64 位十六进制加换行).
- [x] 成功与失败路径都不留 `.credential.arw-tmp-*` 临时文件.
- [x] 已存在的凭据不被覆盖, 内容非法仍报 `Background Agent credential is invalid.`.
- [x] 上述验证命令退出码 0.

## Blocked by

- None - can start immediately

## Validation

- `pnpm typecheck`, `pnpm test` (863 个测试全部通过), `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node arw.mjs text check`, `git diff --check` 退出码均为 0.
- 新增 `tests/background-agent/daemon.test.mjs` 四个测试 (第四个: 目标在预检查后发布前被他方创建时沿用它, 无临时文件残留): mock `link` 在发布前观察到 `credential` 不存在且临时文件为完整 64 位十六进制加换行, 发布后无 `.arw-tmp-` 残留; `link` 失败时无临时文件和凭据残留; 已存在的非法凭据保持原样并报 `Background Agent credential is invalid.`.
- 体积: `git diff --cached --numstat` 非测试代码净增 16 行 (`daemon.mjs` 7 增 9 删, `filesystem.mjs` 24 增 6 删), 超出预算 6 行, 原因见 `## Comments`.
- Spec Readiness: 记录 `not-applicable` 例外 (用户 2026-11-02 常设确认), `arw spec-readiness verify --issue issue:0053:01` 通过.
- 只删减与合并的自查: 复用公共 `create-atomic`, 不另写发布序列, 已删除专用实现; 无可再删减内容.

## Comments

- 提交审核第 1 轮: 曾把发布序列移入 `private-state.mjs`; 第 2 轮 4 条 (重复实现公共 `create-atomic`, 清理错误覆盖原始失败, 函数命名与 EEXIST 语义, Validation 数字与描述不准) 一并解决: 改为扩展公共 `create-atomic` (`sync` 与可选 `fileMode`), daemon 复用并显式处理 collision, 专用函数已删除, Validation 已按实际重写. `process-identity.mjs` 的同类写入不在本 issue 范围. 因 `## What to build` 改动, 已重新记录 `not-applicable`.
- 提交审核第 3 轮: 修复 `link()` 的 `EEXIST` 映射为 `filesystem-create-collision` 并加竞态 mock 测试, 成功发布后的临时文件删除改为尽力清理, `fileMode` 对临时文件 `chmod` (同时 `temporaryWritten` 死标志与 daemon 的 `?? status` 回退随改写消失). 因 `## What to build` 改动, 已重新记录 `not-applicable`.
- 提交审核第 4 轮: 只对 `link()` 的 `EEXIST` 映射 collision, `open` 失败 (临时文件不是本次创建) 直接报 `failed` 且不清理, 其余失败仍为 `failed`; 因此公共 `create-atomic` 的错误分支拆成三段, 非测试净增 16 行, 超出预算 10 行 6 行: 超出来自把 `open`, `link` 与其余步骤的失败语义分开, 没有可再合并的写法. 预算只写在 `## What to build`, 未改 subject, 无需重录 `not-applicable`.
