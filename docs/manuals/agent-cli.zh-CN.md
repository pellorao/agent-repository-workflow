# 配置和启动 Agent CLI

[English](agent-cli.md) | [简体中文](agent-cli.zh-CN.md)

每次启动外部 Agent CLI 时都手敲模型参数和推理设置既繁琐又容易出错. 你可以把常用的启动预设保存在 ARW 中, 以后只用一条 `arw agent start <name>` 命令就能直接拉起 Main Agent. 运行该命令时, ARW 会选中你保存的命名配置, 先放上配置里的固定参数, 再追加本次运行传入的额外参数, 直接启动外部 Main Agent CLI.

本手册面向准备使用 ARW 保存并启动 Agent CLI 配置的用户. 如果还没有安装 ARW 或尚未启用目标 Git 仓库, 请先按 [根 README](../../README.zh-CN.md) 完成首次使用路线. 下文只就地解释读懂示例所需的外部 CLI 选项, 完整选项语义仍以对应 CLI 的官方资料为准.

## 保存命名配置

要通过 ARW 启动 Agent CLI, 首先需要定义一或多个命名配置. 每个配置名称代表一条由你维护的启动方式, 例如一条用于架构规划, 另一条用于编码实施. 名称只用来选择配置, 不会映射到 ARW 的 Agent Role, Reviewer 或平台内部身份.

### 找到用户配置文件

命名配置保存在 ARW Engine Installation 目录下的 `config.json` 中. 安装或更新 ARW 时终端会显示该目录路径; 如果忘记了位置, 可以先查找当前终端实际调用的 `arw` 启动器所在目录:

```text
# Bash
dirname "$(command -v arw)"

# PowerShell
Split-Path (Get-Command arw).Source
```

打开该目录中的 `config.json`. 这个文件由用户拥有, ARW 更新普通受管理文件时不会替你维护其中的 Agent 选项. 如果 `config.json` 不存在, 仍是旧版结构或无法通过验证, 不要自行猜测 `configVersion`, 请先按 [安装长期规格中的全局配置说明](../specs/agent-repository-workflow-installation/spec.md#global-engine-configuration) 完成安装或受支持的升级.

### 编写 Codex 或 Claude Code 配置

打开 `config.json` 后, 在当前全局配置版本 (`configVersion: 3`) 下编写预设. 常见做法是按工作性质准备两条启动方式: `arch` 用于架构和方案工作, `impl` 用于具体实施工作. 根据你实际使用的 Agent CLI, 从下面两个完整示例中任选一个写入 `config.json`. 两个示例互为替代, 不要合并.

如果使用 Codex, 可以直接从本仓库当前采用的完整配置开始:

```json
{
  "configVersion": 3,
  "agents": {
    "arch": {
      "command": "codex",
      "args": [
        "--model",
        "gpt-6-astra",
        "-c",
        "model_reasoning_effort=\"high\""
      ]
    },
    "impl": {
      "command": "codex",
      "args": [
        "--model",
        "gpt-6-sol",
        "-c",
        "model_reasoning_effort=\"high\""
      ]
    }
  },
  "editor": {
    "command": "code",
    "args": ["{file}"]
  },
  "reviewEditor": {
    "command": "code",
    "args": ["--new-window", "--wait", "{file}"]
  },
  "jira": {
    "listLimit": 50
  }
}
```

如果使用 Claude Code, 则采用结构相同的替代配置:

```json
{
  "configVersion": 3,
  "agents": {
    "arch": {
      "command": "claude",
      "args": [
        "--model",
        "opus",
        "--effort",
        "high"
      ]
    },
    "impl": {
      "command": "claude",
      "args": [
        "--model",
        "sonnet",
        "--effort",
        "high"
      ]
    }
  },
  "editor": {
    "command": "code",
    "args": ["{file}"]
  },
  "reviewEditor": {
    "command": "code",
    "args": ["--new-window", "--wait", "{file}"]
  },
  "jira": {
    "listLimit": 50
  }
}
```

示例中的 `arch` 和 `impl` 取值只是可直接采用的起点, 并非 ARW 默认值或强制推荐. 在每条预设中, `args` 保存每次启动都要排在最前面的固定参数, 每个参数项都必须写成独立字符串, 并按目标 CLI 要求的顺序排列:

- `--model` 为当前启动选择模型.
- 在 Codex 示例中, `-c` 会覆盖紧随其后的配置项, 因此 JSON 字符串 `model_reasoning_effort=\"high\"` 需要转义内层双引号.
- 在 Claude Code 示例中, `--effort high` 为当前会话设置推理强度.

由于可用模型和参数可能随外部 CLI 版本与账户条件而变化, ARW 只保存并原样转发你填写的字符串, 不验证它们的语义. 如果需要更换模型或推理强度, 请查阅对应产品的官方资料:

- Codex 的命令与配置项分别见 [Codex CLI reference](https://developers.openai.com/codex/cli/reference/) 和 [Codex configuration reference](https://developers.openai.com/codex/config-reference/).
- Claude Code 的启动参数见 [Claude Code CLI usage](https://code.claude.com/docs/en/cli-usage), 模型别名, 可用模型和推理强度见 [Claude Code model configuration](https://code.claude.com/docs/en/model-config).

### 选择可执行程序

除了配置 `args`, 还要确保 `command` 指向操作系统可以直接执行的程序. ARW 直接启动目标程序, 不会调用命令解释器, 不会展开环境变量, 也不会把 `args` 拼接成一条 shell 命令. 因此 `command` 必须是 `PATH` 中可直接执行的程序名, 或可执行文件的绝对路径; `./tool`, `..\tool` 等相对路径都会被拒绝. 在 Linux 和 macOS 上, 直接启动的文件还必须具备操作系统要求的执行权限.

由于不经过命令解释器, Windows 上的 `.cmd` 或 `.bat` 包装脚本不在直接执行 Interface 的保证范围内. 如果必须调用这类脚本, 请在 `command` 中显式指定可执行的解释器, 并把脚本路径作为独立参数放入 `args`:

```json
{
  "command": "cmd.exe",
  "args": ["/d", "/s", "/c", "C:\\tools\\agent-wrapper.cmd"]
}
```

PowerShell 脚本也采用同样方式: 把 `command` 设为 `pwsh.exe`, 再把 `-NoProfile`, `-File` 和脚本的绝对路径作为独立字符串依次放入 `args`.

## 启动配置并传递参数

保存好 `config.json` 后, 在目标 Git 仓库内的任意当前目录运行:

```text
arw agent start <name> [agent-arguments...]
```

`<name>` 必须与 `agents` 下的属性名完全一致, 且区分大小写. 启动前, ARW 会先完整读取并验证全局配置, 再向上查找最近的 Git 工作树根目录并选中该配置. 目标仓库不需要预先存在 `.scratch` 目录, 但如果在 Git 仓库之外调用, 或前置检查出现任何失败, ARW 都会直接报错停止, 不会启动外部进程.

前置检查通过后, ARW 先传入配置里的固定 `args`, 再按原有顺序追加 `<name>` 后面的本次参数. 因为 `<name>` 之后没有任何 ARW 自有选项, 普通参数, 外部 CLI 选项乃至字面量 `--` 都会原样传给目标 CLI, 不需要额外添加分隔符.

例如, 下面这条命令会选中 `impl`, 并把 `--help` 追加到该配置的固定参数之后 (具体启动 Codex 还是 Claude Code, 取决于你前面写入的是哪份完整配置):

```text
arw agent start impl --help
```

### 恢复外部 CLI 会话

既然 `<name>` 之后的所有参数都会原样透传, 恢复历史会话也可以直接通过追加参数完成.

如果此前写入了 Codex 示例, 当前可移植的恢复命令是:

```text
arw agent start impl resume --last
```

如果此前写入了 Claude Code 示例, 恢复指定会话的命令是:

```text
arw agent start impl --resume <session>
```

ARW 只负责把这些参数传给目标 CLI, 不会检查会话是否存在, 不读取会话身份, 也不会改变目标 CLI 的失败结果. 会话恢复参数的完整含义与可用条件仍以 [Codex CLI reference](https://developers.openai.com/codex/cli/reference/) 和 [Claude Code CLI usage](https://code.claude.com/docs/en/cli-usage) 为准.

## 理解进程和会话边界

外部 CLI 启动后, ARW 会把终端控制权交给该进程. 了解以下三条边界, 可以避免在工作目录, Reviewer 身份和多终端并发上产生误解:

- **工作目录, 标准流与退出码:** 尽管 ARW 会确认当前处于 Git 仓库内, 但它不会自动切换到所发现的 Git 根目录, 外部 CLI 的工作目录始终保持为你调用 `arw agent start` 时的当前目录. 子进程直接继承当前终端的标准输入, 标准输出和标准错误. ARW 会等待进程结束并原样传递正常的非负整数退出码; 如果启动失败或进程没有返回正常数值退出码, ARW 会报告操作失败.
- **Main Agent 与内部 Reviewer 的区别:** 每次调用启动的都是外部 Main Agent CLI 进程, 而不是 `code-standards-reviewer`, `requirements-reviewer` 或 `spec-readiness-reviewer` 等平台内部 Reviewer. 就算把配置名称起得与这些内部身份相同, 也不会建立映射或共享职责.
- **会话生命周期与并发保护:** 会话生命周期和恢复结果完全由外部 CLI 自己管理. ARW 不维护进程或会话登记表, 不在后台启动, 监控或复用外部 CLI 会话, 也不阻止多个可写 Main Agent 同时运行. 如果你在多个终端中工作, 请自行确保同一工作树在同一时间只有一个可写 Main Agent.
