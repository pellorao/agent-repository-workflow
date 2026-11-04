# Claude 后端长路径会话定位, 审核运行层宿主两处缺陷, 两处死代码与规范对齐

Status: completed

## What to build

本 issue 不含设计决定. 维护者已确认这类 issue 不需要治理设计 (2026-11-02 的常设确认), 使用 Spec Readiness 的 not-applicable 例外. 不改变任何公开 Interface 或持久格式.

### Claude 长路径会话定位

Claude Code 把项目目录名中超过 200 个字符的部分截断, 并追加一个由运行时相关哈希算出的后缀. Claude 后端按规则算出的目录因此不存在, 首轮之后的回合错误地用 `--session-id` 新建同一个会话 id, 而不是 `--resume`. 能力测试场景位于工作树内时会产生约 207 字符的此类目录. 修复: 按规则算出的目录名超过 200 个字符时, 与会话元数据读取 (`readClaudeSession`) 共用同一个按会话 id 在全部项目目录中查找记录的函数; 找到时会话记录路径指向该记录. 其他情形 (名称不超长, 没有找到) 保持按规则算出的路径. 会话记录路径在首轮之前是按规则算出的路径, 首轮之后指向实际记录, 而管理进程重启后的恢复以首次记录的路径作为期望值, 因此 Claude 后端的 `resume` 返回它收到的期望路径 (没有期望值时返回当前路径), 不再因路径形式改变而报告原线程已变.

### 审核运行层宿主

- 恢复暂停的 Reviewer 任务时, 调用方的仓库根目录与其他 Reviewer 操作一样必须是绝对路径, 相对路径与缺失一样拒绝, 不按管理进程的工作目录解析; 三处相同的绝对路径守卫合并为一个函数.
- `list_agents` 与 `wait_agent` 的响应在发出前要再检查一次 Reviewer 运行; 这次检查失败时, 把该失败 (含其错误码) 作为响应发出, 与首次检查失败时的处理一致, 并照常把本次响应带出的消息标记为已送达, 而不是抛出一个丢失错误码的新错误, 跳过送达标记.

### 死代码

- `strata-models.mjs` 的 `applyStrataCatalogSupport` 删除无人传入的 `readText` 参数.
- `strata-driver.mjs` 的 `createStrataDriver` 删除对已校验过的 `installationDirectory` 重复的 `isAbsolute` 检查 (提供方配置在 `model-catalog.mjs` 读入时已校验为绝对路径, 管理进程只用该配置创建驱动).

### 规范对齐

行为已由 effort 0084 与 0085 授权并实现, 只改规范文字:

- `docs/specs/agent-repository-workflow-development/spec.md` 的 Skill 登记规则: 名称不是合法 Skill 身份的 `.agents/skills/` 直接子目录 (含至少一个文件) 得到 `skill-source-path-invalid`, 每个这样的目录只报告一次.
- `docs/specs/agent-repository-workflow/spec.md` 的执行规则副本规则: Spec Readiness 取工作树文件字节时, Git 清单仍列出但已在工作树中删除的文件被跳过.

体积预算: 非测试代码净增约 +6 行 (长路径定位约 +7, 含共用查找函数 +3; 宿主约 +3, 合并三处重复的绝对路径守卫; 死代码约 -4); 文档约 +250 字符. effort 0084 issue 台账中只在本机成立的措辞 (违反 `docs/agents/writing.md`) 属另一个 effort, 由 Main 单独以非实施提交修改, 不在本 issue 内.

## Acceptance criteria

- [x] 会话记录位于被截断的项目目录 (名称前 200 个字符加后缀) 时, Claude 后端的回合使用 `--resume`, 会话记录路径指向该实际记录, `resume` 返回收到的期望路径; 工作目录不超长, 或没有找到记录时行为不变.
- [x] 恢复暂停的 Reviewer 任务时, 相对的调用方仓库根目录被拒绝, 并给出与其他 Reviewer 操作一致的 "launching Git repository" 错误.
- [x] `wait_agent` (与 `list_agents`) 在发出响应前的运行检查失败时, 失败结果 (含错误码) 被发出并作为结果返回, 本次响应带出的消息被标记为已送达.
- [x] `readText` 与重复的 `isAbsolute` 已删除, 相关既有测试不改断言即通过.
- [x] 两处规范文字与实现一致.
- [x] 按 `validation` Skill 完成受影响区域的验证, 完整 Source Checkout 验证通过.

## Blocked by

- None - can start immediately

## Validation

- 定向测试 (先红后绿): `node --test tests/background-agent/claude-sessions.test.mjs tests/background-agent/host.test.mjs`, 新增三个测试 "a session record in the shortened project directory of a long working directory is resumed", "a failed run check before emitting a wait response is emitted with its code and still marks the messages delivered", "resuming a paused Reviewer requires an absolute launching repository root", 修复前各自失败, 修复后通过, 回调耗时分别为 29 ms, 13 ms, 30 ms; 修复后 `readClaudeSession` 与会话路径共用 `findClaudeSessionRecord`, `tests/background-agent/claude-sessions.test.mjs` 全部通过.
- `readText` 与重复 `isAbsolute` 的删除由既有 `tests/background-agent/strata-driver.test.mjs`, `tests/background-agent/model-catalog.test.mjs` 不改断言通过覆盖.
- 实测净增 (`commit-audit prepare`): 代码 +6 行, 文档 +114 字符, 测试 +57 行, 在预算内 (代码 +6).
- `pnpm typecheck` 通过; `pnpm test` 904 通过, 0 失败; `node scripts/check-workflow-distribution.mjs`, `node scripts/project-claude-skills.mjs --check`, `node scripts/generate-install-arw.mjs --check`, `node arw.mjs text check`, `node arw.mjs terms check --include .scratch/0087-claude-backend-and-host-fixes/`, `git diff --check` 通过; 受影响文件 `node --check` 通过.
- 规范: 两处规范文字与 `lib/workflow-distribution/workflow-distribution-sync.mjs` 的 `checkSkillRegistration` 和 `lib/spec-readiness/spec-readiness.mjs` 的 `workTreeRuleFiles` 现有行为一致 (`grep` 核对).

## Comments

- 提交审核第 1 轮 Code Standards 指出长路径查找与 `readClaudeSession` 的按会话 id 查找重复. 采纳: 长路径定位复用共享的按会话 id 查找函数, 不再单独按目录名前缀匹配. 一个会话 id 是 UUID, 只对应一份记录, 没有需要确定性裁决的多匹配情形. 这是同一修复中对 issue 事实的改写, 已同步 What to build 与验收项, 交付目标不变, 就绪例外记录随 subject 重新生成.
