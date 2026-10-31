---
name: wizard
description: 生成交互式 bash 向导 (wizard), 引导人类完成只有人才能执行的步骤. 用于配置基础设施, 设置凭据或 CI secrets, 逐步走过不熟悉的第三方控制台, 或执行一次性迁移或切换. Agent 自己能执行的步骤不要调用.
---

# 向导 (Wizard)

**wizard** 是一个 bash 脚本, 逐步引导人类完成一套手工流程, 这类流程手动做很繁琐, 每次向 AI 重新解释也很繁琐. 它会打开每个 URL, 准确说明要点击和复制什么, 捕获这些值, 把它们写到该去的地方 (`.env`, GitHub secrets), 在每个阶段确认, 并显示还剩多少个阶段. 它可以配置第三方服务, 执行一次性迁移, 或把项目从一种状态迁移到另一种状态.

[template.sh](template.sh) 已经解决了令人愉悦的交互体验: 分阶段进度, 确认关卡, 跨平台打开 URL (包括 WSL), 隐藏输入 secret, 幂等的 `.env` 更新写入, `gh secret`/`gh variable` 写入, 以及结尾摘要. **你的工作只是界定流程范围并编写各阶段.** `STAGES` 标记之上的库在每个 wizard 中都完全相同, 这种一致性正是关键所在, 绝不要手动修改它.

wizard 默认是临时的. 一次性脚本保存在 [environment.md](../../../docs/agents/environment.md) 定义的当前会话工作区中. 写任何脚本之前, 先按 [agent-writes.md](../../../docs/agents/agent-writes.md) 准备其恢复基线. 对于要在仓库中交付的可重复使用脚本, 先通过 [implement](../implement/SKILL.md) 的 Entry 确认已授权的 issue, 再依据目标仓库的目录布局选择其路径.

## Process

### 1. Scope the procedure

梳理人类必须执行的每个手工步骤, 以及沿途捕获的每个值. 先读仓库, 不要一上来就问:

- 对于设置: `.env`, `.env.example`, `.env.*`, `README`, `docker-compose*`, 框架配置, 以及 `.github/workflows/*` (每个 `secrets.*` / `vars.*` 引用都是 wizard 必须产出的值).
- 对于迁移或转换: 当前状态, 目标状态, 以及两者之间不可逆的操作.

然后向用户展示有序的阶段列表和每个阶段产出的值并请其确认, 他们可能会增加, 删除或重新排序.

**完成标准:** 每个阶段都已按顺序命名, 并且对每个被捕获的值, 你都知道 (a) 人类从哪里获得它, (b) 它写到哪里 (`.env`, GitHub secret, 两者都写, 或哪里都不写, 有些阶段只是纯操作), 以及 (c) 它是 secret (隐藏输入) 还是公开的.

### 2. Map each stage's journey

对每个阶段, 写出人类遵循的精确路径: 打开哪个 URL, 在那里做什么, 值显示在哪里, 它填入哪个变量, 例如 "Dashboard → Developers → API keys → Reveal test key → copy". 如果你并不确切知道当前的界面或准确的命令, 就如实说明, 并询问用户或查阅文档, 绝不要编造可能不存在的步骤.

**完成标准:** 每个阶段都能追溯到陌生人也能照做的具体说明.

### 3. Author the wizard

把 `template.sh` 复制到目标路径. 把示例阶段替换为每个步骤一个 `stage`, 按依赖顺序排列. 使用库的辅助函数 `stage`, `say`/`step`, `open_url`, `ask`/`ask_secret`, `write_env`, `set_secret`/`set_var`, `pause`/`confirm`, 并把 `TOTAL_STAGES` 设为你编写的阶段数.

坚持模板设定的标准: 先打开 URL 再询问其值, 任何 secret 都用 `ask_secret`, 每个需持久化的值都用 `write_env`, 只对 CI 确实需要的值用 `set_secret`, 任何不可逆操作之前都用 `confirm`. 每个 `stage` 会清屏, 使只有当前步骤可见, 所以让一个阶段只承担一个聚焦的任务, 避免人类需要的内容滚出屏幕. 不要改动标记之上的库.

### 4. Verify and hand off

- 运行 `bash -n <script>`. 使用 [validation](../validation/SKILL.md) 选择目标仓库声明的检查.
- `chmod +x <script>`.
- 不要自己端到端运行它, 因为它会打开浏览器并阻塞等待人工输入. 改为静态追踪: 第 1 步的每个值都被捕获, 并落在第 1 步所说的位置, 并且每个 `set_secret` 的名称都与 CI 中的某个 `secrets.*` 引用完全一致.
- 告诉用户如何运行它. 对于可重复使用的设置路径, 按 issue 的授权记录其入口, 并通过 [commit](../commit/SKILL.md) Skill 处理任何提交.
