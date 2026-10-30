# 三方视图的会话临时工作区

## Behavior

维护者运行 `node scripts/upstream-sync.mjs <source> <commit>` 时, 三方视图的 Git 缓存和 base, theirs, merged 输出都保存在当前平台会话的 `.tmp/<agent-platform>/<sessionId>/_upstream-sync/<source>/` 下. 平台与会话身份由现有 Platform Adapter 提供, 不从来源名或提交号猜测. 同一来源在不同会话中的输出相互隔离, 同一会话重复运行只刷新自己的视图. 不读取, 迁移或删除旧 `.tmp/upstream-sync/` 中的状态.

身份不可取得时, 在创建临时目录和拉取上游前停止, 报告现有身份解析错误. 来源配置, 固定提交, 文件映射, 排除项, 上游日志和三方合并的现有含义不变. 这条维护命令只生成视图, 不采用上游内容或修改来源记录.

## Module Design

### Modules

现有维护入口消费 Platform Adapter 和公共临时工作区能力, 不创建新的模块或路径解析器.

### Interfaces

命令参数保持 `<source> <commit>`. 临时输出路径按 Behavior 解析, 现有来源与合并结果保持不变. 身份缺失使用现有错误, 不继续写入.

### Seams and Adapters

现有 Platform Adapter 从运行环境读取平台会话身份, 现有临时工作区能力负责验证身份和生成目录.

### Dependencies and Data Flow

维护入口从 Platform Adapter 取得身份, 交给临时工作区能力, 在返回的当前会话目录中为来源创建缓存与三方输出. 后续 Git 操作继续消费这些文件.

### Module Design Rationale

复用现有能力使维护入口与其他源码仓库命令采用同一会话隔离规则, 避免一次运行覆盖另一会话的视图. 每个会话独立保存 Git 缓存会增加磁盘占用和重复拉取, 接受这些成本以避免共享可写状态; 旧目录保留不动, 由维护者自行管理. 使用现有 Platform Adapter 意味着缺少平台会话身份的普通终端不能运行此命令; 不新增手工身份参数, 以保持单一身份权威和现有入口范围.

### ADR Evaluation

不改变维护入口位置或新增架构边界, 不新增 ADR.

## Validation

在隔离的普通候选快照中使用本地 Git 来源, 分别提供 Codex 和 Claude Code 会话身份. 观察两次运行各自生成 base 与 theirs 输出, 只在各自会话目录生成缓存, 原有旧目录哨兵不变. 缺少身份时观察命令失败且没有创建同步目录或拉取缓存. 不访问上游网络, 不实际采用 Skill 版本.
