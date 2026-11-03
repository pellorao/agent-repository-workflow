# Source Checkout 验证命令

## Source Checkout validation commands

完成前取得以下全部必要源码仓库验证的当前有效结果. 实施期间先进行相关定向检查, 独立命令按 `.agents/skills/validation/SKILL.md` 的 Reuse and parallel runs 节并行或复用, 列表顺序不构成命令间依赖. 实际需要某个产物或当前主仓库来源时保留该依赖和准确版本核对.

- `pnpm typecheck` - 运行完整的严格 JavaScript 检查, 不输出文件.
- `pnpm test` - 运行完整 Node.js 内置测试套件, 隐藏成功条目, 保留测试日志, 失败诊断和完整最终统计. 需要逐项结果时改用 `pnpm test:verbose`, 无需重复运行两种模式; 两种模式都不自动保存日志.
- `node scripts/check-workflow-distribution.mjs` - 验证生产 Workflow Distribution 投射.
- `node scripts/project-claude-skills.mjs --check` - 比较 `.claude/skills/` 与 `.agents/skills/` 的投影, 不一致时退出码为 `1`.
- `node scripts/generate-install-arw.mjs --check` - 检查生成的安装引导脚本是否与源码一致.
- `node --check <file>` - 只检查本次受影响的 JavaScript 或 ESM 文件的语法, 不执行文件; 没有适用文件时跳过.
- `node arw.mjs text check` - 验证 `.arwignore` 选定的当前 Git 可见文本.
- `node arw.mjs terms check --include .scratch/<NNNN>-<effort-slug>/` - 在即时模式下根据术语表验证当前工作树和当前 issue 的实际 effort 目录.
- `git diff --check` - 检查已跟踪差异中的空白错误.

管理进程运行安装目录中的代码 (安装目录有 `lib/arw-background-agent-host.mjs` 时), 管理进程一侧的改动须 `node install.mjs` 后才在真实管理进程中端到端生效; 确定性测试直接构造管理进程, 不受影响.

Source Checkout 使用 pnpm 11, TypeScript 和 Node.js 24 类型声明作为开发工具. 除非后续 issue 明确添加该范围, 否则不得引入或运行 Vitest, ESLint, Prettier, Playwright, 浏览器检查或其他第三方工具.
