# Configure and start an Agent CLI

[English](agent-cli.md) | [简体中文](agent-cli.zh-CN.md)

Instead of retyping model flags and reasoning settings every time you launch an external Agent CLI, you can save named launch presets in ARW and start your Main Agent with a single command. When you run `arw agent start <name>`, ARW selects the named configuration you saved, prepends its fixed arguments, forwards any extra arguments for the current run, and launches the external Main Agent CLI directly.

This guide is for users who are ready to save and start Agent CLI configurations with ARW. If you have not installed ARW or enabled your target Git repository yet, complete the first-time setup in the [root README](../../README.md) first. Below, we explain external CLI options only as far as needed to make the examples clear; the official references for each CLI own the full semantics of those options.

## Save a named configuration

To launch an Agent CLI through ARW, you first define one or more named configurations. Each configuration name represents a launch method that you maintain, such as one preset for architecture work and another for implementation. The name only selects a configuration; it does not map to an ARW Agent Role, Reviewer, or internal platform identity.

### Find the user configuration file

ARW stores your named configurations in `config.json` inside the ARW Engine installation directory. Installation and update output prints that directory path, but if you have forgotten where it lives, you can locate the `arw` launcher active in your current terminal:

```text
# Bash
dirname "$(command -v arw)"

# PowerShell
Split-Path (Get-Command arw).Source
```

Open `config.json` in that directory. Because you own this file, ordinary updates to managed ARW files leave your Agent options untouched rather than maintaining them for you. If `config.json` is missing, still uses an old structure, or fails validation, do not guess `configVersion` by hand; instead, follow the global configuration instructions in the [installation long-term specification](../specs/agent-repository-workflow-installation/spec.md#global-engine-configuration) (in Chinese) to complete an installation or supported upgrade first.

### Write a Codex or Claude Code configuration

Once you have `config.json` open, define your presets under the current global schema (`configVersion: 3`). A practical setup splits launches into two styles based on the work ahead: `arch` for architecture and planning work, and `impl` for implementation work. Choose one of the two complete examples below for the Agent CLI you use and write it to `config.json`. The two examples are alternatives; do not combine them.

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

If you use Claude Code, use this alternative with the same structure instead:

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

The `arch` and `impl` values in these examples are working starting points you may adopt directly, not built-in ARW defaults or required recommendations. Inside each preset, `args` stores the fixed parameters that ARW places before every launch. Write each argument as a separate string in the exact order required by the target CLI:

- `--model` selects the model for the current launch.
- In Codex, `-c` overrides the configuration item that follows it, so the JSON string `model_reasoning_effort=\"high\"` escapes its inner quotation marks.
- In Claude Code, `--effort high` sets the reasoning effort for the current session.

Because available models and flags can change with your external CLI version and account conditions, ARW only saves and forwards the strings you choose; it does not validate their meaning. When you need a different model or effort setting, check the official documentation for your CLI:

- For Codex commands and configuration items, see [Codex CLI reference](https://developers.openai.com/codex/cli/reference/) and [Codex configuration reference](https://developers.openai.com/codex/config-reference/).
- For Claude Code launch arguments, see [Claude Code CLI usage](https://code.claude.com/docs/en/cli-usage); for model aliases, available models, and effort settings, see [Claude Code model configuration](https://code.claude.com/docs/en/model-config).

### Choose an executable

In addition to setting `args`, make sure `command` points to a program the operating system can execute directly. ARW launches the executable without starting a command interpreter, expanding environment variables, or joining `args` into a shell command. As a result, `command` must be either the name of a program executable from `PATH` or an absolute path to an executable file; `./tool`, `..\tool`, and other relative paths are rejected. On Linux and macOS, a directly launched file must also have the execute permission required by the operating system.

Because ARW does not run a shell, Windows `.cmd` or `.bat` wrapper scripts are not covered by the direct-execution Interface. If you must use a wrapper script, set `command` to an executable interpreter and pass the script path as a separate argument in `args`:

```json
{
  "command": "cmd.exe",
  "args": ["/d", "/s", "/c", "C:\\tools\\agent-wrapper.cmd"]
}
```

Follow the same pattern for a PowerShell script by setting `command` to `pwsh.exe` and passing `-NoProfile`, `-File`, and the absolute script path as separate entries in `args`.

## Start a configuration and forward arguments

Once your configuration is saved in `config.json`, run `arw agent start` from your current directory inside a target Git repository:

```text
arw agent start <name> [agent-arguments...]
```

`<name>` must match a property in `agents` exactly, including letter case. Before launching anything, ARW reads and validates the entire global configuration, locates the nearest Git working-tree root, and selects the named preset. The repository does not need a `.scratch` directory in advance, but running the command outside a Git repository, or hitting any earlier validation failure, stops ARW before it starts the external process.

When those checks pass, ARW places the fixed `args` from your configuration first and appends any `[agent-arguments...]` after `<name>` in their original order. Because ARW defines no options of its own after `<name>`, ordinary arguments, external CLI options, and a literal `--` all pass through to the target CLI unchanged without needing an extra separator.

For example, the command below selects `impl` and appends `--help` after that preset's fixed arguments (launching either Codex or Claude Code, depending on which complete configuration you saved earlier):

```text
arw agent start impl --help
```

### Resume an external CLI session

Because every argument after `<name>` passes straight through to the target CLI, you resume an earlier session the same way.

If you saved the Codex example, the current portable invocation is:

```text
arw agent start impl resume --last
```

If you saved the Claude Code example, resume a specified session with:

```text
arw agent start impl --resume <session>
```

ARW simply forwards these arguments; it does not check whether a session exists, read session identity, or alter the target CLI's failure result. The full meaning and availability of session-recovery arguments remain defined by the [Codex CLI reference](https://developers.openai.com/codex/cli/reference/) and [Claude Code CLI usage](https://code.claude.com/docs/en/cli-usage).

## Understand process and session boundaries

Once the external CLI starts, ARW hands control of the terminal to that process. Keeping three boundaries in mind will help you avoid confusion around working directories, Reviewer identities, and multiple terminals:

- **Working directory, streams, and exit code:** Although ARW checks that you are inside a Git repository, it does not switch directories to the discovered Git root; the external CLI runs in the exact directory where you called `arw agent start`. The process inherits your terminal's standard input, output, and error streams. ARW waits for it to exit and propagates a normal non-negative integer exit code; if launch fails or the process exits without a normal numeric exit code, ARW reports an operation failure.
- **Main Agent vs. internal Reviewers:** Every launch starts an external Main Agent CLI process, never an internal platform Reviewer such as `code-standards-reviewer`, `requirements-reviewer`, or `spec-readiness-reviewer`. Giving a configuration the same name as one of those identities does not create a mapping or share responsibility with them.
- **Session lifecycle and concurrency:** The external CLI owns its session lifecycle and recovery results. ARW does not keep a process or session registry, start, monitor, or reuse external CLI sessions, or protect multiple writable Main Agents from running concurrently. If you work across multiple terminals, make sure that only one writable Main Agent uses a given working tree at a time.
