# 第三方模型接入

Status: completed

## What to build

Reviewer 模型配置可以带一组环境变量 (如 `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_MODEL`), Claude 后端启动时注入. 凭据只允许出现在用户级配置中. 另外修复 04 实跑发现的问题: Haiku 不遵守 Reviewer 最终输出格式 (附带解释文字, 被判为不完整), 优先用 `claude -p` 的结构化输出能力约束, 不行再在规则中收紧要求.

预估改动: 约 150 行.

## Spec Requirement

Governing requirements:

- `.scratch/0001-claude-code-migration/spec.md#platform-and-reviewer-runtime`

## Acceptance criteria

- [x] 配置的环境变量被注入 `claude -p` 进程.
- [x] 仓库配置中出现凭据时拒绝并说明.
- [x] 使用手册写明配置方法.
- [x] 真实 Haiku Reviewer 一轮输出被判为完整.

## Blocked by

- issue:0001:04

## Comments

- 配置: 用户级 `config.json` 的 `reviewers.<role>.env` (名称到字符串). 解析后的 Reviewer 设置不含 `env`, 因为设置会写入状态库, 恢复记录和 Reviewer 会话记录; host 只在 Claude 设置中附加调用方的 `programDirectory` (路径, 非凭据), Claude 后端每回合按 `role` 从该目录 `loadConfig` 读取 `env` 并注入 `claude -p` 进程 (manager 打开原生会话时多传 `role`). 这样 `env` 与模型设置来自同一份配置, 源码入口与已安装入口共用守护进程时也不会错配. 仓库 `arw.config.json` 和机器输入的 overrides 出现 `env` 即报错 `reviewers.<role>.env is allowed only in the user-level ARW config.json, because it may hold credentials.`; host 启动 Reviewer 时把仓库配置诊断文字带进错误.
- 输出格式: `claude -p --json-schema` 可用, 但 API 不接受顶层 `oneOf/anyOf`, 改用 `if/then/else` 表达 "`ready` 单独出现, `incomplete` 必须带 `reason`"; Claude Code 在本地校验并让模型重试, `result` 即为 JSON 文本, 无需改 Reviewer 运行时.
- 真实 Haiku (claude 2.1.310) 一轮: 提示中故意要求 "结束前简要解释", 结果 `finalResponse` 为 `{"status":"ready"}`, 报告写入成功, 被判为完整. 另测: 与 schema 矛盾的要求下 schema 被强制拒绝.
- 文档: 用户入口 README (中英) 新增 "让 Claude Reviewer 使用第三方模型" 小节; 长期安装规格的 Reviewer 配置表补 `env` 行.
- 测试: 全量 1062 项, 1057 通过, 2 失败 (已知: `AGENTS.md` 迁移期改名), 3 跳过; typecheck 通过. 改动约 100 行 (含文档), 在预算内.
- 独立审查 (opus): 无凭据泄露. 采纳: `env` 原从守护进程程序目录读取, 与模型设置的来源 (调用方程序目录) 可能不同, 改为随 Claude 设置传入调用方目录; schema 的 `reason` 改为 `pattern: "\\S"` 与运行时 `trim` 判定一致 (真实 Haiku 验证 API 接受); 删除仅为测试存在的 `programDirectory && role` 守卫.
- 未做: 未运行 `/simplify` (本次指示只允许一个审查 agent); 未用真实第三方端点实跑 (无可用凭据); 在 Claude Code 中用户级配置 provider 不是 `anthropic` 时仍用 haiku 默认值, 此时同角色 `env` 照样注入.
