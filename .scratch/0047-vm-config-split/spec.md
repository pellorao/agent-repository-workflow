# 发布验证配置: 本地配置文件加共用机器文件

## Behavior

用户 2026-11-03 的要求: VM 的通用机器信息放在共用机器文件 (本机其他工具也读取); ARW 专用的发布配置和其他只在 ARW 仓库工作时需要的本机配置放进 ARW 仓库本地的一个不被 Git 管理的文件, 不放在 VM 目录里; 发布验证不再每次询问配置路径; 秘密只在共用机器文件中.

### Local configuration file

- 文件是仓库根的 `.arw.local.json`, 只属于 ARW 源码仓库, 不属于 ARW 安装物, 根 `.gitignore` 增加 `/.arw.local.json`. 它不是根目录 `/config.json` (安装后的用户数据), 也不触及 `config.install.json`. 文件里不放秘密, 只放路径和 ARW 自己的设置.
- 顶层按用途分对象, 为以后其他本机设置留出位置; 本次只定义 `release` 对象, 其中是 ARW 发布配置:
  - `sharedMachinesConfig`: 可选, 共用机器文件路径 (相对路径相对本地配置文件所在目录解析, 也可以是绝对路径).
  - `fixturesDirectory`: 保存 fixture 压缩包的目录路径 (`check` 必须有). 相对路径与 `sharedMachinesConfig` 一样, 相对所在配置文件 (本地配置文件或 `--config` 文件) 的目录解析, 也可以是绝对路径.
  - `maxParallelMachines`: 说明性键, 脚本不读取, 与现状相同.
  - `machines.<机器键>`: 只写 ARW 专用的每机键 (如 `nodeExecutables`).
- 数据文件 (fixtures 压缩包等) 留在原处, 配置里只写路径. 维护者的 `release-validation-sources.json` 没有被本仓库任何代码读取, 它保存的是源码目录路径, 若以后有消费者, 其路径设置并入 `release` 对象; 本次不改它.
- `$release` Skill 先读该文件; 缺失 (或没有 `release` 对象) 时才询问维护者各路径并写入, 之后不再询问.

### release-vm.mjs

命令行去掉位置参数 `<config.json>`, 改为可选的 `--config <path>`: `check <machine> <candidate.bundle> --archive <arw.tar.gz> [--config <path>] [--previous <commit>] [--keep]`, `ssh <machine> <command> [--config <path>]`, `down <machine> [--config <path>]`.

- 不传 `--config`: 读取脚本所在仓库根 (由 `import.meta.url` 定位, 不依赖工作目录) 的 `.arw.local.json`, 其 `release` 对象就是 ARW 发布配置.
- 传 `--config <path>`: 该文件本身就是 ARW 发布配置 (顶层即 `fixturesDirectory`, `machines`, 可选 `sharedMachinesConfig`), 不读本地配置文件. 这是旧调用方式 (只给配置路径) 的等价形式, 保留它只是同一段代码的第二个入口, 单文件完整配置因此继续有效, 现有维护者无需迁移. 路径值必须对运行脚本的 Node.js 有效 (用 Windows 的 `node.exe` 时写 Windows 路径).
- 位置参数改为 `--config`: 位置参数可选会与 `<machine>` 含糊, 唯一调用方是 `$release` Skill, 一并更新. 接受的成本: 所有现有调用 (含测试) 改写.

合并: 按机器键取共用文件的条目, 再用 ARW 发布配置同键条目的顶层键逐键覆盖 (浅合并, 一个键的值整体替换, 不深合并). 机器键可以只出现在共用文件, 也可以只出现在 ARW 发布配置. 脚本读取的键只有 `fixturesDirectory`, `sharedMachinesConfig` 和 `machines`, 且只从 ARW 发布配置读取; 共用文件中的顶层键全部被忽略, 共用文件里的 `sharedMachinesConfig` 也被忽略 (只跟随一层).

### Errors

以下情况与现有用法错误一样, 向 stderr 写一行说明并以退出码 2 结束, 说明只含文件路径, 不含文件内容和任何配置值 (不写 JSON 解析器的原始消息, 因为它可能引用文件片段, 而共用文件含密码):

- 无 `--config` 时, 本地配置文件不存在 (ENOENT), 或存在且是有效 JSON 但没有对象值的 `release`: `No release config: pass --config <path> or add a "release" object to .arw.local.json.`
- 任一被读取的文件 (`--config` 文件, 已存在的本地配置文件, 共用文件) 不存在 (本地配置文件除外, 见上一条), 不可读 (如路径是目录, 读取报 EISDIR), 不是有效 JSON, 或顶层值不是对象 (如 `null`, 数组; 文件开头的 UTF-8 BOM 被忽略): `Config file is not readable JSON: <path>` 或 `Shared machines config is not readable JSON: <path>`.
- `sharedMachinesConfig` 存在但不是字符串: `sharedMachinesConfig must be a path string.`
- 机器键在两边都不存在: 沿用 `Machine not found in config: <key>`.
- `check` 缺少 `fixturesDirectory`: 沿用现有错误.

配置文件本身不可读或无效时, 现状是未捕获的异常 (退出码 1, 消息含解析器原文), 本次统一为退出码 2 和只含路径的消息, 这是有意的改变.

## Testing

用现有测试的假 `vmrun`, `ssh`, `scp`, 不启动真实 VM, 配置文件写在临时目录 (需要本地配置文件的情形把 `scripts/release-vm.mjs` 单文件复制到临时目录的 `scripts/` 下运行, 脚本据此把该临时目录当作仓库根, 不改变生产代码). 观察:

- (a0) `fixturesDirectory` 为相对路径时相对所在配置文件目录解析 (`--config` 与本地文件各一例), 而不是工作目录.
- (a) 拆分配置: 共用文件含 `vmrun`, `location`, `snapshot`, `ssh`, ARW 配置含 `fixturesDirectory`, 相对路径的 `sharedMachinesConfig` 和 `nodeExecutables`, `check` 通过且每个 Node.js 都被运行; 改用绝对路径引用也通过.
- (b) 覆盖: ARW 条目的 `nodeExecutables` 覆盖共用条目的同名键; ARW 条目给出 `ssh` 对象时, 共用 `ssh` 的其他字段不再保留 (观察 `ssh` 调用只用 ARW 给出的字段).
- (c) 单边: 机器键只在共用文件 (含 `nodeExecutables`) 时按共用条目运行; 只在 ARW 配置 (无共用条目) 时按 ARW 条目运行.
- (d) 忽略: 共用文件含 `fixturesDirectory` 时, ARW 配置缺少该键的 `check` 仍以 `fixturesDirectory` 缺失退出 2; 共用文件含指向不存在路径的 `sharedMachinesConfig` 时仍通过.
- (e) 退出 2: `--config` 文件不存在, 非 JSON, 或是目录 (EISDIR); 共用文件为目录; 共用文件缺失, 非 JSON, 或 `sharedMachinesConfig` 非字符串; 机器键两边都没有. 对含秘密的共用文件, stderr 不含其中的秘密字符串.
- (f) 现有测试改用 `--config` 后通过.
- (g) 本地配置: 无 `--config` 时读取脚本所在仓库根 (临时目录) 的 `.arw.local.json` 的 `release` 并通过 (`sharedMachinesConfig` 与 `fixturesDirectory` 的相对路径相对该文件目录; 工作目录设为别处也通过); `--config` 优先; 本地文件不存在或无 `release` 对象时输出 `No release config` 并退出 2; 本地文件非 JSON 或是目录时输出 `Config file is not readable JSON` 并退出 2; 消息都不含文件内容; 仓库根 `.gitignore` 含 `/.arw.local.json`.

## ADR Evaluation

新增 `docs/adr/0039-keep-arw-local-settings-in-a-repository-local-file.md`: 仓库本地被忽略的 `.arw.local.json` 是 ARW 发布设置新的持久本机权威位置 (此前由维护者在仓库外的单个 VM JSON 持有), 这是可独立判断的持久权威决定, 其替代方案 (VM 目录, 仓库外位置, 仓库本地) 和取舍, 以及用户 2026-11-03 的要求都写在该 ADR 中. 共用机器文件仍是机器信息和秘密的权威来源. 格式的权威位置是 `$release` Skill 的 `references/vm.md`, 发布长期规范只指向它.

`docs/adr/0031-use-github-and-local-validation-sources.md` 写有 "VM 配置的职责和格式保持不变", 与本次拆分格式冲突, 所以就地只修订这一句 (职责不变, 格式允许拆分, 见 ADR 0039), 不扩写其主题. 0031 和 0039 都是本 effort 的 `adr` Input.

安全边界的结论: 共用文件含 VM 加密密码等秘密, 路径由配置所有者在自己的私有配置里给出 (相对或绝对), 信任边界与现有配置文件相同, 脚本不对路径做范围限制. 本地文件只放路径, 不放秘密, 且被 Git 排除. 错误信息只含路径, 不回显任何文件内容或解析器消息; 合并后的秘密只用于构造 `vmrun` 参数 (现有行为), 不写入任何输出或日志.

## Module Design

### Modules

- `scripts/release-vm.mjs`: 责任增加从本地配置文件或 `--config` 取得 ARW 发布配置, 并加载合并共用机器文件.

### Interfaces

- 命令行: 位置参数 `<config.json>` 变为可选 `--config <path>`. 新增读取仓库本地文件 `.arw.local.json` 的 `release` 对象, 其字段与旧单文件顶层相同, 另有可选 `sharedMachinesConfig` (字符串路径). 错误与退出码见 Errors 节.

### Seams and Adapters

不变: 文件读取直接使用 `node:fs`, 测试经临时目录中的真实小文件与假命令观察.

### Dependencies and Data Flow

数据流: (`--config` 文件, 或本地文件的 `release` 对象) -> 若有 `sharedMachinesConfig` 则读取共用文件 -> 按机器键浅合并 -> 其余逻辑只看合并后的 `machine` 与 ARW 发布配置的顶层键. 依赖方向不变.

### Module Design Rationale

- ARW 设置放仓库本地文件而不是 VM 目录: 它只对这个仓库有意义, 与仓库同生命周期, 本机事实用 `.gitignore` 排除; 共用机器文件不必知道 ARW. 按对象分组 (`release`) 为以后其他本机设置留位置, 不为此预建通用加载器.
- 本地文件由脚本位置 (`import.meta.url`) 定位仓库根, 不依赖工作目录: 无论 Agent 从哪个目录启动脚本 (含用 Windows 的 `node.exe` 经 WSL 路径启动), 结果都一样. 替代方案是读工作目录的文件, 找不到时会明确报 `No release config`, 但在仓库子目录或其他目录运行就会失败, 要用户记得在仓库根运行. 接受的成本: 测试需把脚本复制到临时目录才能放置本地文件, 脚本从仓库外复制出去使用时找不到该文件 (用 `--config`).
- 浅合并: ARW 专用的覆盖只有 `nodeExecutables` 这类整体替换的键, 浅合并最简单且规则一句话说清. 接受的成本: ARW 条目若要覆盖 `ssh` 等对象值, 必须整体给出该对象, 共用文件之后对该对象的修改不会被继承. 拒绝的深合并 (递归合并对象) 会使覆盖语义含糊 (如何删除一个键), 需要更多代码与测试, 而当前没有覆盖对象值的需求.
- 只跟随一层引用: 替代方案是递归跟随, 需要循环检测和更多错误路径, 当前只有两层的需要. 接受的成本: 共用文件不能再引用别的文件, 需要时由维护者合并文件, 共用文件里的该键被忽略而不报错.
- 保留 `--config` 单文件入口只是同一段代码的第二个入口, 避免强制迁移, 也方便测试.

### ADR Evaluation

见上文 `ADR Evaluation` 节: 新 ADR 0039 与 0031 的就地修订.
