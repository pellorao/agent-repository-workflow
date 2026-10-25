# 配置和启动 Agent CLI

[English](agent-cli.md) | [简体中文](agent-cli.zh-CN.md)

这份手册面向已经决定使用 ARW 保存并启动 Agent CLI 配置的用户. 如果还没有安装 ARW 或启用目标 Git 仓库, 先按 [根 README](../../README.zh-CN.md) 完成首次使用路线. ARW 在这里负责选择命名配置, 传递参数和直接启动外部 Main Agent CLI. 本手册只就地解释理解示例所需的选项, 外部 CLI 的完整选项语义仍由对应的官方资料拥有.

## 保存命名配置

每个配置名称代表一条由你维护的启动方式. 名称只用于选择配置, 不会映射到 ARW 的 Agent Role, Reviewer 或平台内部身份.

### 找到用户配置文件

配置文件是 ARW Engine Installation 目录中的 `config.json`. 安装或更新结果会显示该目录. 如果忘记了位置, 可以先找到当前终端实际使用的 `arw` 启动器:

```text
# Bash
dirname "$(command -v arw)"

# PowerShell
Split-Path (Get-Command arw).Source
```

打开该目录中的 `config.json`. 这个文件由用户拥有, ARW 的普通受管理文件更新不会替你维护其中的 Agent 选项. 配置不存在, 仍是旧版结构或无法通过验证时, 先按 [安装长期规格中的全局配置说明](../specs/agent-repository-workflow-installation/spec.md#global-engine-configuration) 完成安装或受支持的升级, 不要自行猜测 `configVersion`.

### 编写 Codex 或 Claude Code 配置

当前全局配置使用 `configVersion: 3`. 保存配置前, 先按工作用途区分两条启动方式: `arch` 面向架构和方案工作, `impl` 面向实施工作. 然后根据实际使用的 Agent CLI, 从下面两个完整示例中选择一个写入 `config.json`. 两个示例互为替代, 不需要合并.

如果使用 Codex, 可以从仓库当前配置采用的完整值开始:

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

如果使用 Claude Code, 可以采用结构相同的替代示例:

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

这两组 `arch` 和 `impl` 值只是可以直接采用的起点, 不是 ARW 默认值或强制推荐. `args` 保存每次启动都要放在前面的固定参数, 每个参数项都写成独立字符串, 并按目标 CLI 要求的顺序排列. `--model` 为当前启动选择模型. Codex 的 `-c` 覆盖紧随其后的配置项, 因此 JSON 中的 `model_reasoning_effort=\"high\"` 需要转义内层双引号. Claude Code 的 `--effort high` 为当前会话设置推理强度.

如果需要选择其他模型或强度, 再查阅对应产品的官方资料. Codex 的可用命令和配置项分别见 [Codex CLI reference](https://developers.openai.com/codex/cli/reference/) 和 [Codex configuration reference](https://developers.openai.com/codex/config-reference/). Claude Code 的启动参数见 [Claude Code CLI usage](https://code.claude.com/docs/en/cli-usage), 模型别名, 可用模型和推理强度见 [Claude Code model configuration](https://code.claude.com/docs/en/model-config). 这些选项可能随外部 CLI 版本和账户条件变化. ARW 只保存并传递你选择的字符串, 不验证它们的语义.

### 选择可执行程序

`command` 必须是 PATH 中可以直接执行的程序名称, 或可执行文件的绝对路径. `./tool`, `..\tool` 和其他相对路径会被拒绝. ARW 不通过命令解释器启动程序, 不展开环境变量, 也不把 `args` 拼成一条 shell 命令.

Windows 的 `.cmd` 或 `.bat` 包装脚本不属于可以直接执行的 Interface 保证. 必须使用这类脚本时, 显式选择可执行的解释器, 并把脚本路径作为独立参数项:

```json
{
  "command": "cmd.exe",
  "args": ["/d", "/s", "/c", "C:\\tools\\agent-wrapper.cmd"]
}
```

PowerShell 脚本可以同样使用 `pwsh.exe`, 并把 `-NoProfile`, `-File` 和脚本的绝对路径分别放入 `args`. Linux 和 macOS 上的直接文件需要具有操作系统要求的执行权限.

## 启动配置并传递参数

在目标 Git 仓库中的当前目录运行:

```text
arw agent start <name> [agent-arguments...]
```

`<name>` 精确匹配 `agents` 的一个属性, 区分大小写. ARW 会先完整读取和验证全局配置, 再发现最近的 Git 工作树根目录并选择该配置. 该仓库不需要预先存在 `.scratch`, 但在 Git 仓库之外调用会失败, 且任何前置失败都不会启动外部进程.

ARW 先传递配置中的固定 `args`, 再按原顺序追加 `<name>` 后的本次参数. 名称之后没有 ARW 自有选项, 因此普通参数, 外部 CLI 选项和字面 `--` 都会原样进入目标 CLI, 不需要额外分隔符.

例如, 下列调用选择 `impl`, 并把 `--help` 追加到该配置的固定参数之后. 实际启动 Codex 还是 Claude Code, 取决于你此前选择写入的完整配置:

```text
arw agent start impl --help
```

### 恢复外部 CLI 会话

会话恢复也是普通参数透传. 如果此前写入 Codex 示例, 当前可移植的调用形式是:

```text
arw agent start impl resume --last
```

如果此前写入 Claude Code 示例, 恢复指定会话的调用形式是:

```text
arw agent start impl --resume <session>
```

这些参数的完整含义和可用条件仍以对应的 [Codex CLI reference](https://developers.openai.com/codex/cli/reference/) 与 [Claude Code CLI usage](https://code.claude.com/docs/en/cli-usage) 为准. ARW 不检查会话是否存在, 不读取会话身份, 也不改变目标 CLI 的失败结果.

## 理解进程和会话边界

外部 CLI 的工作目录保持为调用 `arw agent start` 时的当前目录, 不自动切换到发现的 Git 根目录. 它继承当前终端的标准输入, 标准输出和标准错误. ARW 等待进程结束并传播正常的非负整数退出码. 启动失败或没有正常数值退出码时, ARW 报告操作失败.

每次启动得到的是外部 Main Agent CLI 进程. 它不是 `code-spec-reviewer`, `code-standards-reviewer`, `commit-audit-reviewer` 或 `spec-readiness-reviewer` 等平台内部 Reviewer. 配置名称与这些身份相同也不会建立映射或共享责任.

ARW 不保存进程或会话登记表, 不启动, 监控或复用外部 CLI 会话, 也不为多个可写 Main Agent 提供并发保护. 会话生命周期和恢复结果由外部 CLI 拥有. 如果在多个终端中工作, 由使用者保证同一工作树在同一时间只有一个可写 Main Agent.
