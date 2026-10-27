# Claude 后端每回合运行一个 `stream-json` 输入进程

Claude 后端必须与 Codex 后端同等实现 `Background Agent control` 的全部功能, 包括运行中的 `send_message`, 需要人工决定的请求和中断. [ADR 0032](0032-run-claude-reviewers-through-headless-claude.md) 中 "运行中的指示被拒绝" 及不维持 `stream-json` 输入进程的决定被本决定取代, 其余决定保持不变.

每个 ARW 回合运行一个 `claude -p --input-format stream-json --output-format stream-json --verbose --replay-user-messages` 进程, 首轮用 `--session-id`, 后续回合用 `--resume` 续接同一会话. 标准输入在回合内保持打开: 回合任务和运行中的 `send_message` 都作为用户消息写入, 写入成功即为通道分发事实. Claude 在下一次模型请求边界取用新消息, 已在生成最终回复时则排到下一个 Claude 回合; `--replay-user-messages` 的回显是取用事实; `--include-partial-messages` 的流事件提供模型阶段计量事实. 管理进程在出现 `result` 且所有已写入消息都已回显时关闭标准输入, 进程退出后 ARW 回合才结束, 因此排队的消息仍属于同一 ARW 回合, 最终响应取最后一个 `result`.

权限使用 `--permission-prompt-tool stdio` (Reviewer 另加 `--permission-mode default`): 放行规则内的工具直接执行, 其他工具请求以 `can_use_tool` 控制请求交给管理进程, 作为待决的原生客户端请求供调用方回应. Reviewer 调用层以具体原因拒绝, 模型看到原因后在当前回合改用允许的工具. 中断以 `SIGTERM` 结束该回合进程并等待其退出. 环境变量 `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1` 防止回合结束后仍有后台命令自动开启新回合.

每个运行中的回合进程在私有运行状态目录记录 PID 与操作系统创建时间, 确认退出后删除. 新管理进程据此判断 Claude 运行的旧回合是否已结束, 不检查共享 App Server; 管理进程收到 `SIGTERM` 时停止全部后台 Agent 并确认其进程退出后再退出.

## Rejected alternatives

- 不为每个 Agent 维持跨回合的常驻进程. 空闲 Agent 不需要进程, 按回合运行使容量, 空闲回收和恢复只需核对一个回合进程, 不形成第二套共享服务.
- 不用 `--permission-mode dontAsk`. 它只给出通用拒绝提示, 模型无从纠正, 也无法把需要人工决定的请求交给调用方.
- 不用 `interrupt` 控制请求中断. 进程会继续存活并可能被排队消息开启新回合, `SIGTERM` 能确认回合及其工具都已结束.
- 不为非 Reviewer 角色保留 ARW 放行列表和 `--safe-mode`. 理由: 各平台在公共功能之外使用自己的原生工作方式 (设置, 权限, 指令文件), 不为与 Codex 一致而模仿其机制, 普通后台 Agent 也应遵循用户已配置的权限规则, 权限模式和项目指令. 代价: 用户或项目设置可授予超出调用方读写路径的工具与写入, 调用方路径对这些角色只追加不收窄, 不是安全边界; 需要隔离的角色按 Reviewer 方式运行.

## Consequences

一次 ARW 回合可能包含多个 Claude 回合, 用量按全部 `result` 累计. 所有角色都预先放行 `arw background-agent`, 使后台 Agent 能主动通知 Main. 非 Reviewer 角色按 Claude Code 原生方式运行 (具体范围见 spec 的生产 Claude Adapter), 不受最终状态格式约束, 设置未允许的工具请求作为待决请求交给所属 Main; Reviewer 的放行范围见 ADR 0032.
