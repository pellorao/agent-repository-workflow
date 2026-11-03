# 交互式安装与卸载在管道一次送入多行应答时不丢行

Status: completed

## What to build

批次 A/B 补测 (N3) 发现: 交互式卸载 (`uninstall.mjs`) 在管道一次送入多行应答 (如 `printf 'y\ny\ny\n' | node uninstall.mjs`) 时, 只有第一个询问拿到应答, 之后报 `Interactive input ended before a decision was provided.`. 原因: `lib/installation/cli-prompt.mjs` 的 `askYesNo` 每次用 `readline.question()` 读取一行, readline 在管道输入下一次收到多行后逐行发出 `line` 事件, 没有 `question()` 在等待的行被丢弃 (已复现: 对同一个 readline 连续三次 `question()`, 输入 `y\ny\ny\n`, 第二次即抛 `readline was closed`). `install.mjs` 共用 `askYesNo`, 有同样风险.

让 `askYesNo` 不丢行: 改用该 readline 的异步迭代器 (`readline[Symbol.asyncIterator]()`, 在首次询问时按 readline 实例创建一次并缓存, 它从创建起缓冲 `line` 事件, 且 readline 因输入结束而关闭后仍先交出已缓冲的行), 每次询问输出提示 (`setPrompt` 加 `prompt()`; 输入已结束 readline 已关闭时 `prompt()` 抛 `ERR_USE_AFTER_CLOSE`, 捕获并忽略, 其他错误照常抛出), 再取下一行; 迭代器结束时抛现有的固定错误 `Interactive input ended before a decision was provided.`. `askYesNo` 的参数与对 `install.mjs`, `uninstall.mjs` 的接口不变; 因迭代器在 readline 关闭时自行结束, 去掉 `questionBeforeClose` 里对 `close` 事件的手工监听.

体积预算: 非测试代码净增约 +4 行 (替换 `questionBeforeClose`).

预期验证: `pnpm typecheck`, `pnpm test`, `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `node arw.mjs text check`, `git diff --check`. 测试用内存 readline 替身 (`cli-prompt.test.mjs`), 不启动真实进程; 不对真实 HOME 运行卸载.

## Acceptance criteria

- [x] 同一个 readline 上连续多次 `askYesNo`, 应答已一次性缓冲 (含 readline 随输入结束而关闭之后) 时, 每次询问依序取得各自的一行, 不丢行; 有测试覆盖.
- [x] 输入在某次询问前耗尽或 readline 在询问期间关闭时, 仍以固定错误 `Interactive input ended before a decision was provided.` 失败; 无效应答仍重新询问; 原有 `askYesNo` 测试语义保持.
- [x] 上述验证命令通过.

## Blocked by

- None - can start immediately

## Validation

- `pnpm typecheck`, `pnpm test` (846 通过 / 0 失败), `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `node arw.mjs text check`, `git diff --check` 通过.
- `cli-prompt.test.mjs` 用真实 `readline` 读 `PassThrough` 内存流 (无子进程), 该文件 4 个测试每个不到 5 ms.

## Comments

- 净增: 非测试代码 +19 / -15 (净 +4, `lib/installation/cli-prompt.mjs`), 在预算内. 用 `readline.closed` 判断是否能 `prompt()` 在本仓库的 `@types/node` 里没有该属性, 改为捕获 `ERR_USE_AFTER_CLOSE`.
- 测试替身由手写 `EventEmitter` 改为真实 readline 加内存流: 新机制依赖 readline 的异步迭代器与关闭后缓冲行为, 手写替身无法验证.
