# ARW Development Manual

[English](development.md) | [简体中文](development.zh-CN.md)

This manual is for maintainers who have cloned the ARW source repository and are preparing to change its implementation, documentation, Workflow Distribution payload, or release candidate. Because the source repository contains both ARW's runtime code and the workflow templates distributed to user repositories, knowing which source of truth owns your change, and which validation commands prove it works, keeps you from editing generated files or testing the wrong layer. If you only want to use ARW in another Git repository, start with the [project README](../../README.md) instead.

Here you will choose the right maintenance route for your task, find the entry points for implementation and validation, and navigate the repository by responsibility. This manual is a map, not a duplicate rulebook: stable product contracts live in the [long-term specification (Chinese)](../specs/agent-repository-workflow/spec.md) and the specialized specifications it cites, while Agent operating rules live in the root [AGENTS.md (Chinese)](../../AGENTS.md) and the [docs/agents rules (Chinese)](../agents/).

## Choose a source-maintenance route

Start every change by identifying the final outcome you need and the authoritative document that governs it. Do not pick a familiar script first and work backward to justify using it.

Three terms appear throughout the routes below and keep their exact meanings everywhere in this manual:

- **ARW Artifact**: a registered issue, map, or specification work record under `.scratch`.
- **Spec Readiness**: the governance-preparation review that runs before implementation starts.
- **Commit Audit**: the final requirements check on a frozen commit candidate before a commit completes.

Use the table below to match your goal to its maintenance route and primary source of truth:

| Goal | Route | Main authoritative sources |
| --- | --- | --- |
| Change public commands, installation, repository workflows, ARW Artifacts, or other production behavior | [Change product implementation](#change-product-implementation) | Applicable long-term specifications, ADRs, and implementation issue |
| Change reader documentation, Agent documentation, or terminology | [Check documentation and terminology](#check-documentation-and-terminology) | Target document, writing rules, and applicable governance sources |
| Change the bootstrap script or installation payload | [Bootstrap scripts and Installation](#bootstrap-scripts-and-installation) | Installation long-term specification and manifest |
| Change shared background Agent execution, App Server capacity, or recovery across repositories | [Change product implementation](#change-product-implementation) | Product background Agent rules and installation management rules |
| Change a shared workflow or platform projection | [Workflow Distribution and Platform Projection](#workflow-distribution-and-platform-projection) | Actual workflow files, distribution configuration, and development long-term specification |
| Adopt an external Skill Package update | [Upstream Sync](#upstream-sync) | Source configuration and the `$upstream-sync` Skill |
| Change a Reviewer Role, independent execution, or Reviewer capability validation | [Reviewer configuration and capability validation](#reviewer-configuration-and-capability-validation) | Canonical Role, user configuration, and Reviewer capability rules |
| Validate cross-operating-system installation or maintain the test environment | [Cross-operating-system validation environment](#cross-operating-system-validation-environment) | Active issue and the `$release` Skill |
| Prepare the initial GitHub source migration | [Initial GitHub migration](#initial-github-migration) | Approved migration instructions and the latest source file snapshot |
| Validate or publish a stable release | [Stable release](#stable-release) | Release long-term specification and the `$release` Skill |

When an Agent works in this repository, it starts from the root `AGENTS.md` and follows the triggered workflow rules there; this manual only routes you to the right content and entry points. If your task spans more than one route in the table, check the authoritative source and entry point for each route before you begin.

## Change product implementation

Follow this route whenever you change JavaScript production behavior. First locate the Module and public Interface that own the behavior in the applicable long-term specification, then set up your local baseline, make the change in the corresponding source and test directories, and run the validation checks.

### Prepare the development environment

Before touching code, make sure your local runtime and test baseline are clean. ARW uses native JavaScript, ES Modules, Node.js built-in Modules, `node:test`, and `node:sqlite`, with Node.js 24 as the minimum runtime version and zero third-party runtime dependencies. The source repository uses pnpm 11 only to manage its two development dependencies: TypeScript and the Node.js 24 type declarations.

Run these commands from the repository root to prepare and verify your baseline:

~~~text
node --version
npx get-pnpm
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
~~~

`pnpm typecheck` runs a strict check across all Git-managed `.mjs` files without emitting any build files. `pnpm test` runs the built-in Node.js test suite; if you want to see every individual test case in that same set, run `pnpm test:verbose` instead (you do not need to run both).

### Find implementation responsibility

Once your baseline passes, check the applicable long-term specification to see which Module or Interface owns the behavior you are changing, then jump to its directory. Root entry points only parse arguments and wire commands together; actual business rules live under `lib/<responsibility>/`, named after their lasting domain responsibility:

| Change | First navigation points |
| --- | --- |
| Public CLI routing and nearest Git repository discovery | Root `arw.mjs`, `lib/arw.mjs`, `lib/common/repository.mjs`, and `lib/arw-common/repository.mjs` |
| ARW Artifacts, issue documents, and migrations | `lib/arw-common/` and `lib/artifact-migration/` |
| Spec Readiness or Commit Audit | `lib/spec-readiness/` and `lib/commit-audit/` |
| Background Agent control across callers and shared App Server capacity | `lib/background-agent/`, `tests/background-agent/`, [product background Agent rules (Chinese)](../specs/agent-repository-workflow/spec.md#background-agent-control), and [installation management rules (Chinese)](../specs/agent-repository-workflow-installation/spec.md#background-agent-management) |
| Reviewer-specific roles, review, and report execution | `lib/reviewer-runtime/` and [Reviewer workflow (Chinese)](../specs/agent-repository-workflow/spec.md#reviewer-workflow) |
| Repository workflows and Workflow Distribution payloads | `lib/repository-workflow/` and `lib/workflow-distribution/` |
| Installation, bootstrap script, and uninstall | Root `install.mjs`, `uninstall.mjs`, and `lib/installation/` |
| Platform projections and platform environments | `lib/arw-common/platform-adapter.mjs` and `lib/arw-common/platform-environment.mjs` |
| Source Checkout releases and Reviewer capabilities | `lib/release/` |
| Text, terminology, and language analysis | The relevant shared capabilities in `lib/document-terms/`, `lib/common/`, and `lib/arw-common/` |

Tests mirror this layout under `tests/` by the same lasting responsibilities. When adding or updating tests, target the closest boundary that observes a public result rather than tying test structure to a one-time issue name or a private helper.

### Enter the validation workflow

After editing code and tests, verify your changes. The [validation rules (Chinese)](../../.agents/skills/validation/SKILL.md) and [Source Checkout deterministic validation rules (Chinese)](../agents/source-checkout-validation.md) define which checks are required for your change and how to interpret their output. Common validation commands include:

~~~text
pnpm typecheck
pnpm test
node scripts/check-workflow-distribution.mjs
node --check <changed-javascript-file>
node arw.mjs text check
node arw.mjs terms check --include .scratch/<NNNN>-<effort-slug>/
git diff --check
~~~

If you also need to inspect language character ratios on specific document paths, run `node arw.mjs language inspect <repository-relative-path>...`.

## Maintain Source Checkout content

Not every change touches JavaScript runtime behavior. You may instead be updating documentation, syncing the workflow files that ARW distributes to target repositories, pulling in upstream Skill updates, or preparing a release. The subsections below move from everyday content and payload maintenance to release validation and publishing, showing when each route applies, which specification or Skill owns the full procedure, and which commands start the work.

### Check documentation and terminology

Use this route when you edit reader documentation, Agent instructions, long-term specifications, or project terminology. Each document's content is governed by the target document itself and its applicable governance sources. Before writing, read the [writing rules (Chinese)](../agents/writing.md) and [validation rules (Chinese)](../../.agents/skills/validation/SKILL.md); if you are editing reader manuals or the root README, check the [reader documentation specification (Chinese)](../specs/arw-reader-documentation/spec.md) to see how responsibilities are divided across guides.

Once your edits are in place, verify them with the standard documentation checks:

~~~text
node arw.mjs text check
node arw.mjs terms check --include .scratch/<NNNN>-<effort-slug>/
node arw.mjs language inspect <repository-relative-path>...
git diff --check -- <changed-path>...
~~~

The validation rules determine the exact check scope and how to read the results.

### Bootstrap scripts and Installation

When your change affects how users install or uninstall ARW, including the standalone downloadable bootstrap script, the installation payload, initial global configuration, or the uninstall entry point, follow this route. The [installation long-term specification (Chinese)](../specs/agent-repository-workflow-installation/spec.md) governs installer behavior and payload contents, while the [development long-term specification (Chinese)](../specs/agent-repository-workflow-development/spec.md) defines how source files map to generated artifacts.

Because the standalone bootstrap script is generated from source, regenerate and verify it with:

~~~text
node scripts/generate-install-arw.mjs
node scripts/generate-install-arw.mjs --check
~~~

To test installation directly from your cloned Source Checkout, run `node install.mjs` from the repository root; to uninstall, run `node uninstall.mjs` inside the ARW installation directory.

Keep the two installation paths distinct. End users install stable releases from the public GitHub repository ([pellorao/agent-repository-workflow](https://github.com/pellorao/agent-repository-workflow)) using the standalone Bootstrap script, which downloads `arw.tar.gz` from a GitHub release and never falls back to `main`. Maintainers and developers who clone `main` and run `node install.mjs` from the checkout root use local-source mode instead, which requires external Node.js and Git and stamps the installation with a `<version>-pre` identity.

### Workflow Distribution and Platform Projection

If you edit the shared Agent workflows that ARW installs into user repositories, or change distribution settings, platform projections, or platform-native seed files, you must synchronize the distribution payload. In the source repository, `.agents/skills/`, the managed regions of Agent documents, canonical Roles, and fixed license files are the authoring sources; `distribution/` is the generated installation payload synchronized before a release. The [development long-term specification (Chinese)](../specs/agent-repository-workflow-development/spec.md) defines how sources map to `distribution/`, and the [platform standards (Chinese)](../../.agents/skills/platform-standards/SKILL.md) specify the target formats and entry points for each platform.

To synchronize `distribution/` from your source edits and run the production checks, use:

~~~text
node scripts/sync-workflow-distribution.mjs
node scripts/check-workflow-distribution.mjs
~~~

The sync command takes no arguments. Both the development specification and the platform standards define which inputs these commands read, and the [Reference check (Chinese)](../specs/agent-repository-workflow-development/spec.md#reference-check) section of the development specification explains how to handle notices emitted during synchronization.

### Upstream Sync

Some Skills in `.agents/skills/` originate from an external Skill Package rather than being written from scratch in this repository. To adopt a newer upstream version of those Skills, explicitly invoke the [`$upstream-sync` Skill (Chinese)](../../.agents/skills/upstream-sync/SKILL.md). Under that Skill, the Agent runs `node scripts/upstream-sync.mjs <source> <full-commit-id>` to build a three-way comparison between the previous upstream snapshot, the new upstream commit, and your current `.agents/skills/`. You then review and approve the changes batch by batch, and the adoption record is saved in `upstream/sources/<source>/adoptions.md`. (Propagating those adopted edits into `distribution/` still uses the separate pre-release Workflow Distribution sync above.)

### Reviewer configuration and capability validation

When you change canonical Reviewer Roles, Reviewer execution rules, or the benchmark scenarios that test Reviewer quality, you need to verify that Reviewers still catch what they should. Canonical Roles live in `docs/agents/roles/`, and shared execution and communication rules live in [Reviewer responsibilities (Chinese)](../agents/reviewer.md). Cross-repository background Agent capacity, connection handling, and recovery belong to the [product background Agent rules (Chinese)](../specs/agent-repository-workflow/spec.md#background-agent-control) and [installation management rules (Chinese)](../specs/agent-repository-workflow-installation/spec.md#background-agent-management), while user model and tier settings (stored in the ARW program directory's `config.json` and the repository's `arw.config.json`) follow the [Reviewer configuration specification (Chinese)](../specs/agent-repository-workflow-installation/spec.md#reviewer-configuration).

To run Reviewer capability validation, explicitly invoke the source-only `$reviewer-capability` Skill. Its test scenarios (materialized fixtures, answer keys, blind-judge briefs, and anchors from the qwen_strata benchmark v2) live in `tests/fixtures/reviewer-capability/`. The Skill drives three command groups, each of which prints JSON and exits with `0` on success, `1` when blocked or failed, or `2` on a usage error:

~~~text
node scripts/reviewer-capability.mjs setup <scenario-directory> <new-target-directory>
node scripts/reviewer-capability.mjs score <scenario-directory> <report> [--instance ID] [--decisions FILE]
node scripts/reviewer-capability.mjs pool build|prompt|split|override ...
~~~

### Cross-operating-system validation environment

Local unit tests cannot prove that installers, PATH registration, and `arw workflow init` behave properly across clean operating systems. To verify those end-to-end on real Windows and Linux systems, follow the VM validation procedure in the source-only `$release` Skill (`.agents/skills/release/`, Chinese), which defines the VM configuration, guest requirements, and snapshot discipline. During a run, `scripts/release-vm.mjs` restores a clean VMware snapshot, copies the candidate Git bundle into the guest over SSH, executes `scripts/release-guest-check.mjs` inside the guest, and restores the snapshot again when finished.

### Initial GitHub migration

Before publishing releases on GitHub, the initial source migration exports the latest `master` file snapshot along with approved local changes into a fresh GitHub `main` branch with no prior commit ancestors, leaving old branches, tags, and Git history behind. Preparing local files or reading migration instructions does not perform the push: you manually export the final snapshot, create the new root commit, configure the GitHub `origin`, push only `main`, set `main` as the default branch, and verify the remote file tree. Follow the specific one-time migration instructions for the exact commands, and if the remote contains unexpected files or history, stop and inspect it rather than overwriting it.

This one-time source transfer is separate from a version release and creates neither a Git tag nor a GitHub Release. Although the [GitHub migration target](https://github.com/pellorao/agent-repository-workflow) is public, the initial migration itself is always performed manually by the user.

### Stable release

Once code, distributions, and cross-platform checks are ready, use this route to validate and publish a stable version. An Agent runs the release workflow only when a maintainer explicitly invokes the release Skill (`$release` in Codex, `/release` in Claude Code). That Skill coordinates the local checks, VM validation, Git tagging, GitHub Release creation with the `arw.tar.gz` asset, and verification of the public Bootstrap script, all governed by the [release long-term specification (Chinese)](../specs/agent-repository-workflow-release/spec.md).

## Navigate code by responsibility

Whether you are implementing a feature or maintaining distribution scripts, you can locate any file by starting at the right entry layer (root commands, `scripts/`, or `lib/`) and following its imports and matching tests. Treat directory structure as a navigation aid; the authoritative Module and Interface boundaries remain in the long-term specifications.

### Root entry points

Files at the repository root wire up the CLI, installer, toolchain configuration, and top-level Agent rules:

- `arw.mjs`, `arw`, and `arw.cmd` are product entry points run directly from the source repository.
- `install.mjs` and `uninstall.mjs` are installation entry points run from a cloned checkout.
- `package.json`, `pnpm-lock.yaml`, and `tsconfig.json` respectively hold the product version and development commands, the actual development dependency tree, and strict JavaScript check configuration.
- `config.install.json`, `release-manifest.json`, and `release-validation.json` respectively serve initial global configuration, installation payload, and release validation.
- `AGENTS.md` and `CONTEXT.md` respectively provide the repository's Agent entry rules and durable domain vocabulary.

### scripts

Unlike the root entry points, direct children of `scripts/` are maintenance tools for the Source Checkout or the standalone downloadable bootstrap script; none of them become public `arw` subcommands:

| Entry point | Responsibility |
| --- | --- |
| `scripts/check-workflow-distribution.mjs` | Validate production Workflow Distribution payloads and platform projections |
| `scripts/generate-install-arw.mjs` | Generate or check the separately downloadable bootstrap script |
| `scripts/install-arw.mjs` | Separately downloadable bootstrap script that starts installation from a fixed release source |
| `scripts/pack-release.mjs` | Pack the installation payload into the release archive `arw.tar.gz`, which `$release` uploads as a release asset |
| `scripts/release-guest-check.mjs` | In a disposable test system, check install, PATH registration, `arw workflow init`, and uninstall |
| `scripts/release-vm.mjs` | Run the guest check in a VMware VM and restore its snapshot |
| `scripts/reviewer-capability.mjs` | Reviewer capability suite entry: build a scenario repository, score a report, build and use blind pools |
| `scripts/sync-workflow-distribution.mjs` | Synchronize the pre-release Workflow Distribution in one command |
| `scripts/upstream-sync.mjs` | Build the upstream three-way view for the `$upstream-sync` Skill |

### lib

Both the root commands and `scripts/` delegate their work to `lib/`, which holds all production implementation and Source Checkout-only maintenance Modules. Its subdirectories follow a strict one-way dependency hierarchy:

- Specific business responsibilities live in dedicated `lib/<responsibility>/` directories and may depend on `lib/arw-common/` and `lib/common/`.
- `lib/arw-common/` holds shared capabilities that depend on ARW domain semantics and are reused across business areas; it may depend on `lib/common/`.
- `lib/common/` holds general utilities with no ARW semantics; it must not depend on ARW semantics or any other `lib/` directory.

Root-level files directly under `lib/` connect multiple responsibilities. Keep module imports direct: do not automatically add an `index.mjs` barrel file, a pass-through forwarding layer, or a new Module Interface just because a directory exists.

### Main directories

Beyond `scripts/` and `lib/`, the remaining top-level directories separate authoring sources, generated payloads, documentation, tests, and working state:

- `.agents/skills/` contains the Skill Packages used and maintained by the Source Checkout.
- `distribution/` contains reviewed workflow-distribution installation payloads produced before release.
- `docs/specs/` contains long-term product behavior, `docs/adr/` contains hard-to-reverse decisions, `docs/agents/` contains Agent operating rules, and `docs/manuals/` contains human-reader guides.
- `tests/` is organized by the long-term responsibilities in `lib/`. Root-level tests cover root wiring and cross-responsibility invariants; `tests/helpers/` and `tests/fixtures/` contain shared test infrastructure.
- `.scratch/` contains ARW Artifacts and completion evidence; it is not the Engine's temporary directory.
- `.tmp/` contains short-lived Engine state for the current platform and session, not authoritative Git-managed data.
- `upstream/` contains external-source configuration and adoption records. The three-way view is written to the ignored `.tmp/<agent-platform>/<sessionId>/_upstream-sync/<source>/`.

## Further reading

When you need the full contract behind any route or directory summarized above, go to the authoritative document that owns it:

- [Project README](../../README.md): project fit, first success, and the main route for users.
- [Agent Repository Workflow long-term specification (Chinese)](../specs/agent-repository-workflow/spec.md): public commands, ARW Artifacts, Agent CLI, Repository Workflow, and product Modules.
- [Development long-term specification (Chinese)](../specs/agent-repository-workflow-development/spec.md): Source Checkout layout, Workflow Distribution, platform projections, and shared Modules.
- [Installation long-term specification (Chinese)](../specs/agent-repository-workflow-installation/spec.md): bootstrap, installation, global configuration, PATH, and uninstall.
- [Release long-term specification (Chinese)](../specs/agent-repository-workflow-release/spec.md): release candidates, Reviewer capabilities, VM validation, tags, and external writes.
- [Reader documentation specification (Chinese)](../specs/arw-reader-documentation/spec.md): README and manual responsibilities and boundaries.
- [Validation rules (Chinese)](../../.agents/skills/validation/SKILL.md): current Agent validation responsibilities and documentation checks.
- [Source Checkout deterministic validation rules (Chinese)](../agents/source-checkout-validation.md): current complete validation entry points; coverage routes are in [Source Checkout deterministic coverage (Chinese)](../agents/source-checkout-coverage.md).
- [Commit rules (Chinese)](../../.agents/skills/commit/SKILL.md): scope, reviews, and Commit Audit when the user requests a commit.
