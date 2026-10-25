# Configure and start an Agent CLI

[English](agent-cli.md) | [简体中文](agent-cli.zh-CN.md)

This guide is for users who have decided to save and start Agent CLI configurations with ARW. If ARW is not installed yet or the target repository has not been enabled, follow the [root README](../../README.md) first. Here ARW selects a named configuration, forwards arguments, and directly starts the external Main Agent CLI. This guide explains options only as far as needed to understand its examples; the corresponding official references own the full semantics of external CLI options.

## Save a named configuration

Each configuration name represents a launch method that you maintain. A name selects a configuration; it does not map to an ARW Agent Role, Reviewer, or internal platform identity.

### Find the user configuration file

The configuration file is `config.json` in the ARW Engine installation directory. Installation and update results show that directory. If you have forgotten its location, first find the `arw` launcher actually used by the current terminal:

```text
# Bash
dirname "$(command -v arw)"

# PowerShell
Split-Path (Get-Command arw).Source
```

Open `config.json` in that directory. The user owns this file; ordinary updates to managed ARW files do not maintain its Agent options for you. If the configuration is missing, has an old structure, or fails validation, follow the global configuration instructions in the [installation long-term specification](../specs/agent-repository-workflow-installation/spec.md#global-engine-configuration) (in Chinese) and complete an installation or supported upgrade. Do not guess `configVersion`.

### Write a Codex or Claude Code configuration

The current global configuration uses `configVersion: 3`. Before saving a configuration, choose between two launch styles based on the work: `arch` is for architecture and planning work; `impl` is for implementation. Then choose one of the two complete examples below for the Agent CLI you use and write it to `config.json`. The examples are alternatives; do not combine them.

If you use Codex, you can start from the complete values currently used by this repository:

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

If you use Claude Code, you can use this alternative with the same structure:

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

The `arch` and `impl` values in these examples are starting points you may adopt; they are not ARW defaults or required recommendations. `args` stores fixed parameters to place before every launch. Write each argument as a separate string and order them as required by the target CLI. `--model` selects a model for the current launch. Codex's `-c` overrides the following configuration item, so the JSON string `model_reasoning_effort=\"high\"` escapes the inner quotation marks. Claude Code's `--effort high` sets reasoning effort for the current session.

If you need another model or effort setting, consult the official references for the relevant product. Codex commands and configuration items are documented in [Codex CLI reference](https://developers.openai.com/codex/cli/reference/) and [Codex configuration reference](https://developers.openai.com/codex/config-reference/). Claude Code launch arguments are documented in [Claude Code CLI usage](https://code.claude.com/docs/en/cli-usage); model aliases, available models, and effort settings are in [Claude Code model configuration](https://code.claude.com/docs/en/model-config). These options can change with the external CLI version and account conditions. ARW only saves and forwards the strings you choose; it does not validate their meaning.

### Choose an executable

`command` must be the name of a program executable from PATH or an absolute path to an executable file. `./tool`, `..\tool`, and other relative paths are rejected. ARW does not start a command interpreter, expand environment variables, or join `args` into a shell command.

Windows `.cmd` or `.bat` wrapper scripts are not covered by the direct-execution Interface. If you must use one, explicitly choose an executable interpreter and pass the script path as a separate argument:

```json
{
  "command": "cmd.exe",
  "args": ["/d", "/s", "/c", "C:\\tools\\agent-wrapper.cmd"]
}
```

You can similarly use `pwsh.exe` for a PowerShell script, with `-NoProfile`, `-File`, and the absolute script path as separate entries in `args`. On Linux and macOS, a directly launched file must have the execute permission required by the operating system.

## Start a configuration and forward arguments

From the current directory inside a target Git repository, run:

```text
arw agent start <name> [agent-arguments...]
```

`<name>` must exactly match a property in `agents`, including case. ARW first reads and validates the entire global configuration, then finds the nearest Git working-tree root and selects this configuration. The repository does not need a `.scratch` directory in advance, but the command fails outside a Git repository and does not start the external process after any earlier failure.

ARW forwards the fixed `args` from the configuration first, then appends the per-run arguments after `<name>` in their original order. There are no ARW-specific options after the name, so ordinary arguments, external CLI options, and a literal `--` all go to the target CLI unchanged; no extra separator is needed.

For example, this chooses `impl` and appends `--help` after the configuration's fixed arguments. Whether it starts Codex or Claude Code depends on which complete configuration you previously saved:

```text
arw agent start impl --help
```

### Resume an external CLI session

Session recovery also uses ordinary argument forwarding. If you saved the Codex example, the current portable invocation is:

```text
arw agent start impl resume --last
```

If you saved the Claude Code example, resume a specified session with:

```text
arw agent start impl --resume <session>
```

The full meaning and availability of these arguments remain defined by the relevant [Codex CLI reference](https://developers.openai.com/codex/cli/reference/) and [Claude Code CLI usage](https://code.claude.com/docs/en/cli-usage). ARW does not check whether a session exists, read session identity, or change the target CLI's failure result.

## Understand process and session boundaries

The external CLI's working directory remains the current directory where you called `arw agent start`; ARW does not switch to the discovered Git root. The process inherits the current terminal's standard input, output, and error streams. ARW waits for it to exit and propagates a normal non-negative integer exit code. If launch fails or there is no normal numeric exit code, ARW reports an operation failure.

Each launch starts an external Main Agent CLI process. It is not an internal platform Reviewer such as `code-spec-reviewer`, `code-standards-reviewer`, `commit-audit-reviewer`, or `spec-readiness-reviewer`. Giving a configuration the same name as one of these identities does not create a mapping or shared responsibility.

ARW does not keep a process or session registry, start, monitor, or reuse external CLI sessions, or protect multiple writable Main Agents from running concurrently. The external CLI owns session lifecycle and recovery results. If you work in multiple terminals, ensure that only one writable Main Agent uses a given working tree at a time.
