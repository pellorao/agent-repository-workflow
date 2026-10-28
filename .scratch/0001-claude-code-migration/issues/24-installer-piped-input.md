# 安装器管道输入与半途失败

Status: completed

## What to build

ticket 21 冒烟 (2026-10-27) 发现: `node install.mjs` 用 `<<< n` 之类的单行管道应答时报 "Interactive input ended"; 安装中途失败会留下缺少 `lib/` 的安装目录. 修正为能读取管道输入. 失败时不留下不完整安装目录的要求不在本 issue 内 (见下).

2026-10-28 triage: ticket 30 后安装器的写入全在询问之后, 询问 EOF 时尚未创建安装目录, 故 "缺少 `lib/`" 现已不能由询问失败产生. 根因是 `install.mjs` 在安装前的异步检查之前就创建 readline, 单行管道输入在询问发出前已读完并关闭, 询问收到 close. 本 issue 只修管道输入: `install.mjs` 改为在询问时才创建 readline, 此时管道数据仍在缓冲中, 同步发出的询问能读到它.

半途失败的处理 (第二项) 与长期规格冲突: 规格 "实际 I/O 失败立即停止并报告, 不承诺完整回滚", 失败返回 `partial` 并列出人工清理要求 (ADR-0017). 把它改为回滚是规格与持久状态决策, 不在本 issue 内自行做出, 已提交 Main 列入 `decide`; 本 issue 的验收只含第一项.

预估净增约 +4/-2 行 (`install.mjs`), 测试约 +15 行.

## Spec Requirement

Governing requirements:

- `docs/specs/agent-repository-workflow-installation/spec.md#public-entry-points`

## Acceptance criteria

- [x] 单行管道应答可以完成安装.

## Blocked by

- None - can start immediately

## Validation

- `pnpm test` 723 项通过 (1 项既有 skipped), `pnpm typecheck`, `node scripts/check-workflow-distribution.mjs`, `node arw.mjs text check` 通过. 临时 HOME 下 `<<< n` 与 `<<< y` 实测安装成功.
- 实际净增: `install.mjs` +6/-3, 测试 +26/-9 (含无效单行应答的 EOF 案例), 规格 2 句.
- 新增的真实进程测试实测约 550 毫秒 (`n` 与 `y` 各一次完整本地安装), EOF 测试约 250 毫秒 (两个进程), 均超过 100 毫秒阈值; 未找到更快且仍证明修复的办法 (进程启动与一次本地安装本身约 130 毫秒). 已提交 Main 请用户批准例外.
