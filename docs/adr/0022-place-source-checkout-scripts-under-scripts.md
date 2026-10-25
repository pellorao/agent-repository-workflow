# 将源码仓库维护脚本放入 scripts

ARW 源码仓库曾将产品入口, 安装入口和仅供维护者直接执行的脚本都置于根目录, 因而无法从根目录清楚辨认哪些文件必须在克隆的源码仓库根目录直接运行. 这些路径会被文档, 生成检查, 发布清单和测试长期引用; 后续改变必须跨多个责任同步, 所以布局需要独立决定记录.

## Decision

根目录只保留必须从克隆的源码仓库根目录运行, 或同时进入安装载荷的 `arw.mjs`, `arw`, `arw.cmd`, `install.mjs` 和 `uninstall.mjs`. 不必从根目录运行的维护入口以及可单独下载的引导脚本, 都作为 `scripts/` 的直接子项并保持扁平布局, 包括 `install-arw.mjs`, `generate-install-arw.mjs`, `release-conformance.mjs`, `sync-workflow-distribution.mjs` 和 `upstream-sync.mjs`. `scripts/` 不按业务责任新增子目录. 直接执行入口只适配参数, 流和退出值, 不复制 Module 策略.

对应实现仍位于 `lib/`, 并按责任分层. 与 ARW 无关的通用公共能力位于 `lib/common/`. 依赖 ARW 语义且由多个具体业务范围复用的公共能力位于 `lib/arw-common/`. 具体业务实现位于按其长期责任命名的 `lib/<responsibility>/` 子目录. `lib/` 第一层只保留连接多个业务范围的顶层实现. 目录本身不产生新的 Module Interface, 转发文件或 `index.mjs` 聚合入口.

依赖方向从具体业务实现指向 `lib/arw-common/`, 再指向 `lib/common/`. `lib/common/` 不依赖 ARW 语义或其他 `lib/` 实现. `lib/arw-common/` 不依赖具体业务实现. 某项由长期规格明确拥有的具体业务 Interface 可以被其他业务范围直接消费, 不因跨目录调用而转移责任.

`scripts/install-arw.mjs` 在源码仓库中是确定性生成和检查的单文件引导脚本, 用户从规范原始文件 URL 下载后可以在任意目录运行, 不依赖旁边的源码仓库文件. 根 `install.mjs` 保持不动, 因为克隆源码仓库的用户与引导安装脚本创建的准确发布检出目录都从根目录调用它. 新布局不保留旧根路径副本, 包装脚本或转发入口; 当前没有已发布 tag, 所以规范下载路径可以直接切换而不建立兼容分支.

本决定只取代 ADR 0011 把 `upstream-sync.mjs` 固定在源码仓库根目录的路径选择. ADR 0011 中仅供源码仓库运行的范围, 用户审核, 批准, 恢复, 同步工作区, 同步记录和不进入安装载荷等决定保持有效 (其中恢复, 同步工作区和同步记录后来已被 [ADR 0011](0011-use-source-only-human-reviewed-upstream-sync.md) 的状态说明取代). ADR 0012 的公开 `arw` Interface 和 ADR 0020 的单文件引导安装脚本与根 Installer 交接也保持不变. [ADR 0026](0026-use-source-checkout-workflow-files-as-distribution-authority.md#decision) 已经取代 ADR 0021 的带类型 Workflow Distribution 清单权威来源, 并把新的发布前同步入口放在本文规定的 `scripts/` 维护入口层.

## Consequences

源码仓库文档, 用法文本, 生成目标, 测试, 发布内容表和排除检查必须使用最终扁平 `scripts/` 路径. 仅供源码仓库使用的文件继续不能进入安装载荷或 Workflow Distribution. 以后新增直接执行文件时, 只有必须从克隆的源码仓库根目录运行或属于安装入口的文件可以放在根目录; 仅供维护者运行的脚本作为 `scripts/` 的直接子项, 实现逻辑按上述责任进入 `lib/` 子目录. import, 安装运行时清单和测试必须使用最终 Module 路径, 不保留旧位置的转发入口.
