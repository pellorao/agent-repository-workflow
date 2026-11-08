# Agent Repository Workflow

[English](README.md) | [简体中文](README.zh-CN.md)

Agent Repository Workflow (ARW) helps you and coding Agents build software together in a local Git repository without losing control of design decisions, code quality, or commits. It is a local workflow manager that connects work records, implementation authorization, Agent collaboration rules, repository configuration, and release maintenance. While Agents handle investigation, implementation, and independent review, ARW keeps important decisions, commits, and external publication under your explicit authorization.

This guide is for developers who know basic terminal, Git, and Node.js operations and are setting up ARW for the first time. To run ARW, you need Node.js 24 or later. Because ARW is written in native JavaScript and ES modules with no npm runtime dependencies, it runs directly on Node.js. Windows and Linux are fully supported; macOS is currently experimental.

## What ARW is for

When a team works with coding Agents in the same Git repository over time, fast code generation creates new risks that raw prompting does not solve:

- Running an Agent in YOLO (You Only Live Once) mode lets it skip necessary understanding, authorization, and validation, which seriously degrades code and documentation quality.
- Code written by an Agent can look complete on the surface while its actual validity remains difficult to establish.
- Agents produce code much faster than humans can review it item by item.
- When the context window fills up, Agent intelligence declines, making it easier to miss constraints or connect information incorrectly.
- Asking the same Agent to repeatedly reread and review its own work to reduce these risks consumes too many tokens.
- Agent-written documentation often fills up with jargon, making actual behavior and responsibility hard for users to understand.

Even with ARW in place, two trade-offs remain:

- The long-term maintainability of Agent-written code is still low. Continuous refactoring can improve it, but at high cost.
- Under ARW's strict process, reviews take much longer than implementation. This makes ARW's short-term return on investment less compelling than YOLO mode.

Because of that review cost, ARW may be too heavy if you only want an Agent to answer occasional questions, or if you do not need work authorization and validation evidence stored in a Git repository. If instead you want users to confirm important decisions, work records to authorize implementation scope, and an independent Reviewer to inspect changes before every commit, follow the first-use path below.

## Quick start

To get started, you first install the shared ARW program for your user account, and then initialize the target Git repository where you plan to use ARW long term. Keeping the ARW source checkout, the installation directory, and your target repository separate prevents you from mixing up their roles.

During repository initialization, ARW asks whether to configure a Code Map. A Code Map is an Agent-maintained set of README files that describe your source directories. It helps future Agents understand each directory's responsibility from its README, and lets validation detect missing descriptions in configured source areas. If your project does not need directory navigation and coverage checks, you can leave it unconfigured.

1. Prepare Node.js 24 or later. Download the single-file [`scripts/install-arw.mjs`](scripts/install-arw.mjs) (Bootstrap) from GitHub, inspect it, and install the highest stable version:

   ```text
   node install-arw.mjs
   ```

2. The installer can register `arw` on your PATH on Windows or Linux. Because your current terminal may retain its old PATH, open a new terminal and verify the installation with `arw --version`. Experimental macOS does not register PATH automatically.
3. Open your target Git repository and run `arw workflow init`. Based on your chosen platform, domain-document layout, and optional Code Map configuration, this writes the repository workflow files. It does not install an Agent CLI.
4. Pass the complete `Agent Post-init Handoff` printed by the command to the Main Agent in your current session. The Agent reviews rule, documentation, and validation gaps that mechanical checks cannot judge. If it finds no gaps, it creates no issue; otherwise it creates exactly one summary issue to complete the repository workflow, and finishes that issue before ordinary implementation begins.
5. Run `arw workflow verify` along with the applicable checks requested by the handoff review, and then run `arw list issues` to see what work is ready to proceed. If the repository has no work records yet, a missing `.scratch` directory and an empty list are both normal and do not indicate failed initialization.

After these five steps, `arw` is available on your machine and your target repository has its own Agent working rules. The next section explains the options and platform details behind installation, initialization, and upgrades; after that, we trace the everyday workflow from your first work record to a reviewed commit.

## Install and configure ARW

In the quick start, you ran two separate setup steps because installation and initialization solve different problems. Installation places the ARW runtime and Workflow Distribution into a fixed directory for your user account. Workflow Distribution is the shared Agent workflow content that target repositories consume during initialization. For the same reason, updating your ARW installation directory is different from running `arw workflow update`: the first replaces your user-level runtime, while the second updates Managed Content inside the current target repository.

### Install the ARW program

For most users, the main installation route is the single-file [`scripts/install-arw.mjs`](scripts/install-arw.mjs) (Bootstrap) from GitHub, which installs a stable release. It requires Node.js 24 or later, and does not require GitLab access, an SSH key, or Git. Always inspect the downloaded file before running it; do not pipe a remote response directly to Node.js. Bootstrap does not accept a remote override or save credentials. Instead, it downloads `arw.tar.gz` (about 0.5 MB, containing only the installation payload) from the GitHub release and unpacks it with the system `tar`.

If you are maintaining or developing ARW itself, you can instead clone `main` and install from the source checkout (shown below). That route uses local-source mode with a version identity of `<version>-pre`, and running `node install.mjs` does not access a remote server. Because source installation verifies source bytes exactly, Git must not convert repository text line endings to Windows form during checkout, or installation will fail on a byte mismatch.

Before running either installer, check your Node.js runtime:

```text
node --version
```

The version must be 24 or later. If the runtime is below that minimum, the installer aborts before downloading source files or writing to disk.

Once Node.js is ready, run Bootstrap interactively to select the highest stable SemVer release by default:

```text
node install-arw.mjs
```

To install the highest stable version without prompts and register PATH automatically, run:

```text
node install-arw.mjs --non-interactive --register-path true
```

If you specifically need a historical version for a first installation, pass an exact stable version that exists on the remote. ARW never downgrades an existing installation: if the installed version is higher than your target version, installation fails and writes nothing, so uninstall first when you need to move to an older version.

```text
node install-arw.mjs --version MAJOR.MINOR.PATCH
```

If you are a source maintainer or developer installing from source, clone the public repository with `-c core.autocrlf=false`. That flag disables line-ending conversion before the first checkout and scopes the setting to this repository only:

```text
git clone -c core.autocrlf=false --branch main https://github.com/pellorao/agent-repository-workflow.git
cd agent-repository-workflow
node install.mjs
```

Do not run `node install.mjs` from a working tree where line endings have already been converted; run the clone command above again so the repository keeps its original bytes. Because the repository is public, cloning does not require private GitLab access. If your goal is to modify ARW source code, continue to the [Developer Guide](docs/manuals/development.md) for the development environment, source navigation, and maintenance paths.

Whichever installation route you use, ARW writes to a fixed user directory:

- Windows: `%USERPROFILE%\.agent-repository-workflow`, even when you run the installer from Git Bash (it does not switch to `$HOME`).
- Linux and experimental macOS: `$HOME/.agent-repository-workflow`.

How the installer registers `arw` on your PATH depends on your operating system:

- Windows updates only `Path` in the current user's Registry. Even when the environment-change notification succeeds, an open PowerShell, CMD, or Git Bash window may keep its old environment. Open a new terminal, sign out and back in, or refresh the current command interpreter manually.
- Linux updates only the exact PATH block marked by ARW in `~/.profile` and never guesses other shell configuration files. Because `~/.profile` is read by a new login shell, sign out and back in, or run `. ~/.profile` in your current shell. If `~/.bash_profile` exists (which causes bash to skip `~/.profile`) or if you use zsh, source `~/.profile` from your own shell configuration file.
- Experimental macOS does not register PATH automatically. Add the directory to PATH yourself or invoke the launcher directly from the installation directory.
- Passing `--register-path false` leaves PATH and shell configuration files untouched, and does not release PATH ownership that ARW established in an earlier install.

Next, open a new terminal and verify that `arw` resolves on your PATH:

```text
arw --version
```

Because the installer does not bundle a copy of Node.js, the `arw` launcher resolves `node` from the active PATH on every run. Running `arw --version` confirms both the launcher and the Node.js runtime visible in your new terminal.

If you later decide to remove ARW from your machine, enter the installation directory and run `node uninstall.mjs`. By default, uninstall preserves your user `config.json`; pass `node uninstall.mjs --remove-config true` if you want to delete it too. The uninstaller removes only the runtime files and PATH or shell entries that a valid installation manifest proves ARW owns, leaving any unknown files untouched.

### Initialize or adjust files in a target repository

Installing `arw` puts the command on your machine, but each project still needs its own Agent rules and platform files. Open a new terminal, enter your target Git repository, and run:

```text
arw workflow init
```

ARW walks upward from your current working directory to find the nearest Git working-tree root, and observes and modifies only that root. Because a nested Git repository never falls back to an outer repository, initialize each repository that uses ARW separately from its own root or one of its subdirectories.

When running from a script or an Agent, use non-interactive mode. You must pass either `--reuse-profile` or a complete Profile replacement that specifies `--platform`, `--domain-layout`, and all three `--code-map-*` options together (passing an option with no value sets an empty list):

```text
arw workflow init --non-interactive --platform codex --platform claude-code --domain-layout single-context --code-map-root --code-map-include --code-map-exclude
```

During initialization, ARW collects or reuses a Repository Profile that records your chosen platforms, domain-document layout, and optional Code Map root, include, and exclude rules. Your selected platforms are the sole basis for which platform files ARW installs: ARW does not scan user-level or platform-built-in Skills, and it does not download or validate an Agent CLI.

If you work on Windows, keep two platform behaviors in mind:

- Git on Windows may check out files with CRLF line endings. ARW ignores line-ending differences when reading repository files, so a CRLF checkout will not trigger false drift errors. To keep line endings consistent across your team, commit a `.gitattributes` file or set `core.autocrlf=false` yourself; ARW does not create or modify either setting.
- ARW on Windows supports only the officially installed native `codex` and `claude` executables: install Codex with its official PowerShell install script, and install Claude Code with its native installer or WinGet. npm-installed `.cmd` wrappers are not supported.

Once `arw workflow init` finishes writing files, it prints the `Agent Post-init Handoff`. Pass that entire handoff block to your Main Agent. Because the gaps detected by the Engine are only initial inputs and cannot rule out deeper semantic gaps, the Main Agent reviews your repository workflow, domain documents and long-term terms, managed areas and duplicate rules, repository-owned validation, writing and filename rules, `.arwignore`, Agent management scope, and preparation for migrating any old ARW Artifacts.

Notice that `workflow init` does not create a root `CONTEXT.md`, `CONTEXT-MAP.md`, or `.scratch` directory on its own. If domain documents are missing or any other review item has a gap, the Main Agent combines every gap into a single repository workflow completion issue. That issue stays at `Status: needs-info` while it waits for your decisions, and moves to `Status: ready-for-agent` once all choices and blockers are resolved. If the handoff review finds no gaps at all, the Agent creates no issue, and having no `.scratch` directory is completely normal.

Once the handoff review (and its completion issue, if one was needed) is finished, verify the repository state:

```text
arw workflow verify
arw code-map verify
arw text check
arw terms check
```

Each verification command checks a distinct contract, so they do not replace one another:

- `arw workflow verify` checks the lock file, Repository Profile, Managed Content, platform projections, and any configured Code Map.
- `arw code-map verify` needs to be run separately only when your Repository Profile configures a Code Map.
- `arw text check` verifies that Agent-managed text files use valid UTF-8 without BOM and LF line endings.
- `arw terms check` locates your terminology source from the repository root (using the `CONTEXT.md` files referenced by root `CONTEXT-MAP.md` if present, or root `CONTEXT.md` otherwise) and checks managed Markdown files while excluding `.scratch` by default. To check an active effort as well, add `--include .scratch/<NNNN>-<effort-slug>/`.

When you upgrade your user-level ARW installation later on, existing repositories do not update automatically. To bring a target repository up to the newer installed workflow content, preview the update plan first, confirm it, apply it, and verify the result:

```text
arw workflow update --dry-run
arw workflow update
arw workflow verify
```

Running `--dry-run` shows exactly how the newer workflow will change the repository without writing anything. Once you are happy with the plan, `arw workflow update` writes the changes and `arw workflow verify` confirms the updated state.

If you are upgrading from an earlier ARW version, check three migration details as well:

- `code-spec-reviewer` and `commit-audit-reviewer` have been merged into `requirements-reviewer`. Settings under the old role names in `config.json` or `arw.config.json` are now ignored, so move any custom model settings to `reviewers.requirements-reviewer`.
- Spec Readiness records now use schema version 7. `arw spec-readiness verify` treats older records on uncommitted issues as stale, including `not-applicable` exception records. Regenerate them using the standard `prepare -> review -> generate -> promote -> verify` sequence, or `generate -> promote -> verify` for an exception.
- If the new workflow removes a rule document that contained repository-owned content, `arw workflow update` moves that content into the repository-owned section of `AGENTS.md` under a heading naming the old file path, deletes the old file, and lists the affected paths after updating. Review the moved text and merge or delete it.

If you stop using ARW in a target repository, run `arw workflow remove`. The command prompts you to choose how to handle platform Agent configuration, `.arwignore`, Code Map files, and mixed Agent documents, and never deletes files whose ARW ownership it cannot prove.

## Complete one JIRA request across multiple repositories

Once your repository is initialized, your next step depends on whether your work stays inside a single Git repository or spans several. When a task modifies only one Git repository, go straight to the everyday workflow below. When a single JIRA request requires coordinated changes across multiple Git repositories, however, a single-repository workflow cannot cleanly separate the overall request, the changes in each repository, and the final JIRA status.

To keep those boundaries clear, ARW's multi-repository path stores the overall request and coordination record in an Application Repository while each Module Repository owns only its own implementation and validation. That separation adds setup work: you configure the repositories, maintain work records on both sides, commit and push in a defined order, and explicitly authorize JIRA writes. In exchange, every piece of state has a single owner, and if a step fails you can retry from an exact boundary.

To decide whether your task needs multi-repository coordination, or to follow the repository roles and step order once you choose this path, read [Distribute work across repositories and sync JIRA](docs/manuals/application-jira.md). When you want an Agent to run that coordination, explicitly invoke the `application-workflow` Skill; neither repository configuration nor JIRA requests trigger it automatically.

## Everyday use

For work inside a single repository, your daily loop follows five stages: check whether runnable work records already exist, start a Main Agent for your session, plan and create an implementation issue if one does not exist yet, run implementation with validation, and request an independent review and commit when the work is done. Finishing implementation never creates a commit automatically; review and commit begin only when you ask for them.

If you are already in an active Agent session and just want to pick a prompt to send right now, open [Everyday commands for Agent conversations](docs/manuals/daily-agent-conversation-commands.md) for a quick reference with decision prompts, then come back here when you need the full workflow context.

### Find and read work records

Every day starts by checking what work is already tracked in the repository. ARW calls its registered `issue`, `map`, and `spec` records ARW Artifacts and stores them under `.scratch` in the nearest Git repository. Each effort lives in `.scratch/<NNNN>-<effort-slug>/`, and each issue lives in `issues/<NN>-<issue-slug>.md`. The numeric prefixes provide a permanent identity, while the descriptive slugs make directory and file paths readable.

When you reference these records in commands or prompts, use their local Canonical IDs: `issue:<NNNN>:<NN>`, `map:<NNNN>`, and `spec:<NNNN>`. Because a Canonical ID omits the slug and file path, it stays valid even if you rename the effort or issue later.

Start by listing the issues that are ready to proceed and have no unfinished blockers:

```text
arw list issues
```

In your terminal, you can also use the short alias `arw li`. By default, this list includes implementation issues in `ready-for-agent` or `ready-for-human` status, along with open, unclaimed Wayfinder issues. Application Source Issues only mirror the status of another repository, so they are omitted by default.

When you need to inspect blocked, completed, or specific types of work, filter the list by status or type:

```text
arw list issues --all-statuses
arw list issues --status ready-for-agent,needs-info
arw list issues --type implementation,application-source,wayfinder
```

To see investigation maps or local specs instead of issues, run:

```text
arw list maps
arw list specs
```

Their terminal aliases are `arw lm` and `arw ls`. By default, `li`, `lm`, `ls`, `lba`, and `jl` format their tables to 100 display columns and truncate only the name column (`Title`, or the session title in `lba`) with `...`; add `--full` (`-f`) to print full names, such as `arw li -a -f`.

Once you spot the record you want in the list, pass its full Canonical ID to `open` or `print`:

```text
arw open issue:0007:02
arw print issue:0007:02
arw open map:0007
arw print spec:0007
```

`open` reads the `editor` setting from your global `config.json`, prints the repository-relative path, launches the editor, and returns immediately. `print` writes the exact original UTF-8 text to stdout so an Agent or script can read it. Both commands accept only local Canonical IDs and never read from Git history or another repository.

If your repository has no ARW Artifacts yet, `.scratch` does not need to exist: `list` returns an empty table with exit code `0`, `migrate artifacts` succeeds as a no-op, and running `open` or `print` on a specific ID returns a controlled `not-found` result. ARW creates parent directories under `.scratch` automatically when it creates the first record, so never create an empty `.scratch` folder by hand just to make a command pass.

Once you have an issue ID, you can ask an Agent to read it and recommend the next action before touching any files:

```text
Read <issue-canonical-ID> and tell me its current status, blockers, and next step. Do not modify files yet.
```

### Start an Agent for the current session

To discuss plans or run an issue, each session needs a single Main Agent that talks with you, coordinates subagent tasks, and owns all Git writes. You do not have to launch that Agent through `arw`: for your first sessions, running your installed and authenticated platform CLI directly from the target repository (such as `codex` or `claude`) is usually the simplest choice.

If you find yourself passing the same CLI flags every day, you can save a named profile in your user-level ARW configuration and launch it from the target repository with:

```text
arw agent start <name> [agent-arguments...]
```

Saving a named configuration only saves typing; it does not turn an external CLI into an internal ARW Reviewer. Before editing that configuration, read the [Agent CLI Guide](docs/manuals/agent-cli.md) for the global `config.json` schema, Codex and Claude Code examples, per-run argument forwarding, executable rules, exit codes, and process and session boundaries. Whichever way you start your Agent, run only one writer per working tree at a time, as ARW does not enforce an automatic write lock.

<a id="create-and-plan-work"></a>

### Create and plan work

With your Main Agent running, check what `arw list issues` returned. If an implementation issue is already `ready-for-agent`, skip ahead to the next section. If no issue exists yet, choose the lightest planning path that resolves what is still unknown, because an implementation issue should authorize file changes only after its requirements and important decisions are settled.

When the overall scope is clear but you still need to settle product behavior or long-term maintenance trade-offs, use `grill-with-docs` to work through each choice and record your confirmed decisions:

```text
I want to add CSV export to the existing list. Use $grill-with-docs to reach agreement with me. Do not implement until I confirm that the discussion is complete.
```

When the problem is broad, spans multiple Agent sessions, or is still too vague to form a concrete requirement, use `wayfinder` to build a shared investigation map and answer one question at a time:

```text
I want to redesign the project's permissions system, but I do not know the full scope yet. Use $wayfinder to create an investigation map. Do not implement product changes yet.
```

Once your investigation and discussion have answered the open questions, use `to-spec` to turn the confirmed decisions into a structured spec without starting a second interview:

```text
Use $to-spec to organize the requirements we have confirmed into a spec. Do not start a new interview.
```

Finally, use `to-tickets` to break the plan or spec into individual implementation issues ordered by blocker relationships, reviewing the proposed split before the Agent writes the files:

```text
Use $to-tickets to split this spec into issues that can be implemented one at a time. Show me the proposed split first; create the records only after I approve it.
```

You do not need to run all four steps for every task; pick only the stages your current task requires. If your requirements are already complete, go straight to splitting issues; if an implementation issue is already authorized, go straight to implementation; if you only want a read-only answer, you do not need an implementation record at all. Keep in mind that a Wayfinder investigation issue never authorizes code changes, and an Application Source Issue only mirrors a Module repository's status. Only a matching, actionable implementation issue authorizes changes to repository deliverables.

As issues move through planning and execution, their `Status` field tells you who acts next:

- `needs-triage`: needs classification and an initial check.
- `needs-info`: waiting on a user decision or an external fact.
- `ready-for-human`: the next action must be performed by the user.
- `ready-for-agent`: user decisions and blockers are resolved, so an Agent may start implementation.
- `completed`: acceptance criteria and required validation are complete and recorded.
- `wontfix`: the issue has been explicitly closed without implementation.

### Start implementation

Once an implementation issue has `ready-for-agent` status and all of its blockers are completed, ask the Main Agent to implement it within clear boundaries:

```text
Use $implement to implement issue:<NNNN>:<NN>. If an important decision has not been confirmed, stop and use $grilling to discuss it with me.
```

When `implement` starts, the Agent first reads the full issue and its effort spec. Next, it runs the Issue Gate to verify the issue's status, blockers, and implementation authorization, and completes Spec Readiness through `prepare -> independent review -> generate -> promote -> verify`. During that sequence, `spec-readiness-reviewer` checks whether the governance design selected by the issue is current, complete, and sufficient to implement. Passing Spec Readiness authorizes the Agent to begin coding that issue; it does not prove that the resulting code will be correct.

With authorization in place, the Main Agent establishes a recoverable Git baseline for the write scope and coordinates the work. Subagents may write within non-overlapping scopes assigned to them, while the Main Agent performs all Git operations. If the work grows beyond the issue scope, hits an unconfirmed important decision, or runs into conflicting repository rules, the Agent stops the affected writes and asks you to decide.

As the Agent writes code, it validates against the issue's acceptance criteria, starting with focused checks closest to the modified files and finishing with the full validation suite required by the repository. Every acceptance criterion must be backed by actual validation evidence. Once all criteria pass, the Agent records that evidence under `## Validation`, checks off the criteria, and sets the issue status to `completed`.

Marking an issue `completed` only updates the work record. It does not stage files, create a Git commit, or sweep in unrelated changes from your working tree.

### Review and commit

Because `completed` stops short of a commit, the Main Agent enters the commit workflow only after you explicitly ask it to commit. Name the exact issue and scope in your prompt:

```text
Review and commit the implementation for issue:<NNNN>:<NN>. Include only changes authorized by this issue and preserve other worktree content.
```

When you send this request, the Main Agent verifies the completion evidence and isolates the exact staged candidate, then runs `arw commit-audit prepare`. ARW derives the review scope from the issue and its applicable specs and creates an empty txt report. Two independent Reviewers then inspect the staged candidate in parallel: `requirements-reviewer` records any unmet requirement it finds, while `code-standards-reviewer` checks repository standards and flags removable code (each writes `No problems.` when clean). Only after both Reviewers finish normally and every reported problem is resolved does the Main Agent run `arw commit-audit verify` and the remaining mechanical checks to create the commit. If fixes require a re-review, the Reviewers inspect only the new changes and their impact while keeping unaffected conclusions.

If your staged candidate contains only investigation notes, design records, or other closed non-implementation files, the Agent can use a lighter commit path. As soon as the candidate includes implementation deliverables for the repository, it must go through the full implementation commit workflow above. The target repository's `code-review` and `commit` Skills define the exact diff preparation, result reuse, and recovery rules, so this README does not repeat their full protocols.

## Common commands

Now that you have seen how setup and the daily workflow fit together, use the tables below as a quick reference for the commands you and your Agent run at each stage. For full flag syntax, run `arw help` in your terminal or check the long-term specifications. While the Main Agent always writes full command names in operating instructions, you can type the short aliases in your terminal.

### Check version and repository configuration

Use these commands when setting up, verifying, upgrading, or removing ARW in a repository:

| Command | Question it answers |
| --- | --- |
| `arw --version` | Which ARW version is running? |
| `arw workflow init` | How do I initialize a workflow for the nearest target Git repository? |
| `arw workflow verify` | Do Managed Content and the current Repository Profile match? |
| `arw workflow update --dry-run` | What target repository content would change, without writing it yet? |
| `arw workflow update` | How do I apply a confirmed workflow update? |
| `arw workflow remove` | How do I remove Managed Content from the target repository using explicit choices? |
| `arw code-map verify` | Does the configured source-directory description cover its scope and have a valid structure? |
| `arw text check` | Does Agent-managed text meet UTF-8, BOM, and LF requirements? |
| `arw text fix` | How can I mechanically repair issues that text checks can fix? |
| `arw terms check [--strict] [--include <repository-relative-directory>]...` | Are terms correct in the current context? `--strict` adds release-name checks; `--include` includes a selected `.scratch` directory. |
| `arw language inspect <repository-relative-path>...` | What language mix is in the explicit Markdown files or directories? This does not judge compliance. |

### Find, open, and read work records

Use these commands during daily work to inspect ARW Artifacts in `.scratch`:

| Command | Short alias | Question it answers |
| --- | --- | --- |
| `arw list issues` | `arw li` | Which issues can proceed without unfinished blockers? |
| `arw list issues --all-statuses` | `arw li -a` | What issues have valid structure and status? |
| `arw list issues --status <status>[,<status>...]` | `arw li -s <status>[,<status>...]` | Which issues use the selected statuses? |
| `arw list issues --type <type>[,<type>...]` | `arw li -t <type>[,<type>...]` | Which issues are `implementation`, `application-source`, or `wayfinder`? |
| `arw list issues --full` | `arw li -f` | What are the full, untruncated titles? |
| `arw list maps` | `arw lm` | Which Wayfinder maps are registered? |
| `arw list specs` | `arw ls` | Which local specs are registered? |
| `arw open <canonical-id>` | - | How do I open a local ARW Artifact in the configured editor? |
| `arw print <canonical-id>` | - | How do I write the exact original text of a local ARW Artifact to stdout? |

Note that `--all-statuses` and `--status` are mutually exclusive, while `--type` can be combined with status filters. If `list`, `open`, or `print` reports a legacy issue or `PRD.md` format, check the entire preflight scope before migrating: `arw migrate artifacts` migrates the nearest repository's entire `.scratch` directory, not just the single record you queried.

### Start a saved Agent CLI configuration

Once you have saved a named Agent profile in your global `config.json`, start it from your target repository with:

```text
arw agent start <name> [agent-arguments...]
```

See the [Agent CLI Guide](docs/manuals/agent-cli.md) for configuration fields, argument forwarding, and process behavior.

### Review commands usually run by an Agent

During implementation and commit reviews, you normally just specify the issue ID and goal in conversation, and let the Main Agent run these gate commands:

| Command | Responsibility |
| --- | --- |
| `arw spec-readiness prepare --issue issue:<NNNN>:<NN> [--input <temp-json-path>]` | Freeze current governance inputs, review subject, and Reviewer Role into a Reviewer Request. |
| `arw spec-readiness generate --issue issue:<NNNN>:<NN> --input <draft-path>` | Validate the independent Reviewer's final draft and generate a temporary readiness result. |
| `arw spec-readiness promote --input <generated-path>` | Revalidate unchanged bindings and promote the exact generated issue result. |
| `arw spec-readiness verify --issue issue:<NNNN>:<NN> [--subject-only]` | Read-only check that implementation authorization for the issue is still valid. With `--subject-only` (used at commit time) only the issue subject is checked, not the governing Inputs or Reviewer Role. |
| `arw commit-audit prepare --input <absolute-input-path>` | Prepare an independent Commit Audit Request from the frozen staged candidate. |
| `arw commit-audit verify` | Read-only check that the final staged candidate keeps every committed ARW Artifact identity. |

### What to check when a command fails

When an ordinary `arw` command exits, code `0` means success or an accepted no-op, `1` means review findings, blockers, or an operation failure, and `2` means invalid command usage (Agent CLI exit codes follow the rules in the [Agent CLI Guide](docs/manuals/agent-cli.md)). Check the matching symptom below to recover:

- `Not inside a Git working tree`: `cd` into your target Git repository root (or one of its subdirectories) and run the command again.
- `.scratch` is absent: this is normal when running `list`, `migrate artifacts`, or repository workflow commands in a repo with no records yet. If `open` or `print` fails on a specific Canonical ID, check whether that record has actually been created.
- `arw` is missing after installation on Windows: open a new terminal window. If the updated environment still has not appeared, sign out and back in or refresh your command interpreter manually.
- `arw` is missing after installation on Linux: confirm that you allowed PATH registration during install, then sign out and back in or run `. ~/.profile`. If `~/.bash_profile` exists or you use zsh, your shell will not read `~/.profile` automatically; load it from your shell config yourself, as ARW never edits other shell files.
- `arw` is missing on experimental macOS: the installer does not register PATH on macOS, so either invoke the launcher from the installation directory or add it to PATH yourself.
- `open` cannot start the editor: check the `editor` field in your global `config.json` (see the [Agent CLI Guide](docs/manuals/agent-cli.md) for the full configuration schema).
- `arw agent start` fails: verify the profile name, arguments, and launch boundary in the [Agent CLI Guide](docs/manuals/agent-cli.md).
- Spec Readiness returns `gap`, `uncertain`, or an expired result: fix the governance document or review input that owns the design, then rerun the full Spec Readiness sequence. Never bypass the check.
- `workflow update` reports unknown ownership or state drift: keep your local changes safe, resolve the conflict against the current `arw-lock.json` and your Git recovery baseline, and rerun the full update.
- Multiple Agents are writing to the same working tree: stop the extra writers immediately, then have the Main Agent re-verify the Git recovery baseline and non-overlapping write scopes.

<a id="reviewers"></a>

## Why independent reviews matter

The commands and workflow gates above rely on independent Reviewers rather than letting the Main Agent check its own work. Because the Main Agent talks with you, chooses scope, coordinates implementation, runs validation, and performs all Git writes, asking it to grade its own output risks carrying over its initial assumptions and blind spots. To get an independent check at the moments that matter most, ARW runs three Canonical Reviewer Roles at two stages:

- `spec-readiness-reviewer`: runs once when an issue's design is finalized to verify that the selected governance design is current, complete, and sufficient to implement, and thereafter re-reviews only changes.
- `requirements-reviewer`: runs after you request an implementation commit to check every issue requirement and applicable long-term requirement against the staged candidate.
- `code-standards-reviewer`: runs in parallel with `requirements-reviewer` at commit time to check the staged candidate against repository standards and applicable writing or code rules.

Together, the Main Agent and Reviewers divide work along this timeline:

```text
Main Agent
|-- before implementation: spec-readiness-reviewer
|-- implementation and validation: Main Agent and subagents with assigned write scopes
`-- after the user explicitly requests an implementation commit
    |-- code-standards-reviewer
    `-- requirements-reviewer
```

Each Reviewer judges only its bound inputs: it never chooses work scope, makes important decisions for the user, edits implementation files, or creates a commit. While the Main Agent can verify the evidence and impact of a Reviewer finding, it cannot override a Spec Readiness or Commit Audit authorization result with its own judgment.

Under the hood, a Reviewer Role is a temporary Agent spawned by the active workflow, not an external CLI profile started via `arw agent start` from your global `config.json`. The two mechanisms share no name mapping or session state. Because independent reviews cost extra wait time and model tokens, ARW runs them only at the pre-implementation and pre-commit gates, trading that cost for a second opinion that is separate from the implementer.

### Use a third-party model for Claude Reviewers

Claude turns inherit the environment of the client that started the background-agent manager, so `ANTHROPIC_API_KEY`, `CLAUDE_CONFIG_DIR`, and login state follow that client rather than the requesting Main, with role `env` overrides applied afterward.

When you use Claude Code, any Reviewer whose `modelProvider` is set to `"anthropic"` runs through headless `claude -p`. If you want that Reviewer to use a third-party model that serves an Anthropic-compatible API, add an `env` object to the role in the `config.json` inside your ARW installation directory. ARW injects those environment variables into every `claude -p` turn:

```json
"reviewers": {
  "requirements-reviewer": {
    "model": "my-model",
    "modelProvider": "anthropic",
    "env": {
      "ANTHROPIC_BASE_URL": "https://models.example.com",
      "ANTHROPIC_AUTH_TOKEN": "<token>"
    }
  }
}
```

Because `env` often contains secret tokens, ARW accepts it only in the user-level `config.json`. If a repository's `arw.config.json` includes an `env` field, configuration validation fails and the Reviewer refuses to start.

### Allow common ARW commands in Claude Code

Whereas Codex receives command-approval rules through `.codex/rules/default.rules`, ARW does not generate `.claude/settings.json`. To let Claude Code run routine `arw` commands without prompting every time, merge the `permissions.allow` list below into your user-level `~/.claude/settings.json` or the repository's `.claude/settings.json`. (When working inside the ARW source repository where commands run as `node arw.mjs`, replace `arw ` with `node arw.mjs ` in each entry.)

```json
{
  "permissions": {
    "allow": [
      "Bash(arw list:*)",
      "Bash(arw li:*)",
      "Bash(arw lm:*)",
      "Bash(arw ls:*)",
      "Bash(arw print:*)",
      "Bash(arw spec-readiness prepare:*)",
      "Bash(arw spec-readiness verify:*)",
      "Bash(arw --version:*)",
      "Bash(arw migrate artifacts:*)",
      "Bash(arw code-map verify:*)",
      "Bash(arw text check:*)",
      "Bash(arw text fix:*)",
      "Bash(arw workflow verify:*)",
      "Bash(arw workflow update:*)"
    ]
  }
}
```

## Included Skills

In addition to CLI gates and Reviewers, `arw workflow init` installs task-specific operating instructions called Skills for the platforms you selected (`.agents/skills` for Codex, and `.claude/skills` for Claude Code). The Agent triggers most Skills automatically as soon as your task matches their scope; the remaining Skills never trigger on their own and wait for you to name them in conversation, such as `Use $grill-with-docs to confirm the requirements with me`. To see the full list of installed Skills, which ones run automatically versus by name, and when to use each, consult the [Skills manual](docs/manuals/skills.md).

## Develop ARW

If your goal is to modify the ARW Source Checkout itself rather than use ARW in another project, do not run `arw workflow init`, `update`, `verify`, or `remove` inside the source repository. The Source Checkout is where Workflow Distribution is authored, not a target repository that consumes that distribution.

Instead, after cloning the Source Checkout, verify that you have Node.js 24 or later from the repository root and head to the [Developer Guide](docs/manuals/development.md). It walks you through preparing the development environment, picking an implementation or maintenance path, running focused and shared validation, and navigating the codebase by responsibility. For stable product contracts and long-term boundaries, refer to the [ARW long-term specification](docs/specs/agent-repository-workflow/spec.md) (in Chinese), as neither this README nor the Developer Guide duplicates those specifications.

## A final note

Every workflow trades speed for certainty: more process makes development heavier and slower, while too little process makes quality hard to trust. Each project has to weigh process cost against quality gains and pick the lightest path that still covers the risk of the change.

That balance will keep shifting as Agent intelligence improves. Whenever a mechanical check no longer provides real protection, or when natural-language review can carry that responsibility better, its cost and benefit should be re-evaluated rather than kept forever out of habit. In the not-too-distant future, ARW itself may no longer be needed at all.

## Further reading

When you are ready to go deeper into a specific workflow or specification, continue with the guide that matches your current task:

- [Distribute work across repositories and sync JIRA](docs/manuals/application-jira.md): When one JIRA request must be completed across multiple Git repositories, use this to judge fit and follow repository responsibilities, operation order, and failure recovery.
- [Agent CLI Guide](docs/manuals/agent-cli.md): When you have decided to save and start an external Agent CLI configuration with ARW, read about configuration, argument forwarding, and process and session boundaries.
- [Everyday commands for Agent conversations](docs/manuals/daily-agent-conversation-commands.md): When you are already in an Agent conversation and want to choose a request to send, use this quick reference with decision prompts.
- [Developer Guide](docs/manuals/development.md): When you have cloned ARW Source Checkout and are preparing to maintain implementation, documentation, Workflow Distribution, or a release candidate, use this to choose a maintenance path and validation entry point.
- [Skills manual](docs/manuals/skills.md): When you want to know which Skills ARW installs, which ones the Agent uses automatically, and which ones you must name, use this list with a purpose and trigger for each.
- [ARW long-term specification](docs/specs/agent-repository-workflow/spec.md): For stable product behavior, security boundaries, and long-term responsibilities (in Chinese).
- [Installation long-term specification](docs/specs/agent-repository-workflow-installation/spec.md): For Bootstrap, global configuration, installation directory, PATH ownership, upgrades, and uninstall contracts (in Chinese).
- [Reader documentation specification](docs/specs/arw-reader-documentation/spec.md): For the long-term responsibilities and routing boundaries of the root README and manuals (in Chinese).
- [Project context](CONTEXT.md): For names already established in ARW Source Checkout and their exclusions (in Chinese).
