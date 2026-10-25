# ARW Development Manual

[English](development.md) | [简体中文](development.zh-CN.md)

This manual is for maintainers who have cloned the ARW source repository and are preparing to change its implementation, documentation, Workflow Distribution payload, or release candidate. If you use ARW to manage another Git repository, start with the [project README](../../README.md). This manual helps you choose a source-maintenance route, find validation entry points, and navigate code by responsibility. Stable product behavior belongs to the [long-term specification (Chinese)](../specs/agent-repository-workflow/spec.md) and the specialized specifications it cites. Agent operating requirements belong to the root [AGENTS.md (Chinese)](../../AGENTS.md) and the [docs/agents rules (Chinese)](../agents/).

## Choose a source-maintenance route

Choose a route based on the authoritative source and the final result you need to change. Do not start from a familiar script and work backward to decide whether it fits the task.

An ARW Artifact is a registered issue, map, or specification work record under `.scratch`. Spec Readiness is the governance-preparation review before implementation. Commit Audit is the final requirements check on a frozen commit candidate. These names retain their precise meaning throughout this manual.

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

An Agent starts from the root `AGENTS.md` and follows the applicable rules. This manual helps maintainers choose a content route; it does not describe the Agent workflow. If a task spans multiple routes, find the authoritative source and entry point for each route first.

## Change product implementation

Use the product implementation route for JavaScript production behavior. Find the Module and public Interface that own the behavior in the applicable long-term specification, then go to the corresponding source and test responsibilities.

### Prepare the development environment

The project uses native JavaScript, ES Modules, Node.js built-in Modules, `node:test`, and `node:sqlite`. Node.js 24 is the minimum runtime version. The product has no third-party runtime dependencies. The source repository uses pnpm 11 to manage its two development dependencies: TypeScript and the Node.js 24 type declarations.

Prepare and check the development baseline from the repository root:

~~~text
node --version
npx get-pnpm
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
~~~

`pnpm typecheck` performs a complete strict check of Git-managed `.mjs` files and generates no files. `pnpm test` runs the Node.js built-in test suite. To show each case in the same test set, use `pnpm test:verbose`; there is no need to run both modes.

### Find implementation responsibility

Find the Module or Interface that owns the behavior in the applicable long-term specification before entering its directory. Root entry points parse and connect commands; specific business rules usually live under `lib/<responsibility>/` named for their lasting responsibility.

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

Tests are organized under `tests/` by the same lasting responsibilities. Choose the closest test boundary that observes a public result. Do not define lasting behavior through a one-time issue name or a private helper's structure.

### Enter the validation workflow

The [validation rules (Chinese)](../../.agents/skills/validation/SKILL.md) and [Source Checkout deterministic validation rules (Chinese)](../agents/source-checkout-validation.md) own the Source Checkout validation entry points. Common command names include:

~~~text
pnpm typecheck
pnpm test
node scripts/check-workflow-distribution.mjs
node --check <changed-javascript-file>
node arw.mjs text check
node arw.mjs terms check --include .scratch/<NNNN>-<effort-slug>/
git diff --check
~~~

The linked validation rules determine when each command applies and how to interpret its result. To analyze additional explicit document paths, use `node arw.mjs language inspect <repository-relative-path>...`.

## Maintain Source Checkout content

This route covers documentation owned by the Source Checkout, workflow sources, platform projections, external-source adoption, and release preparation. Each subsection identifies when to use the route, its owner, and where to start. The linked long-term specifications and Agent rules own the full operating procedures.

### Check documentation and terminology

Use this route to maintain reader documentation, Agent documents, long-term specifications, or terminology. The target document and applicable governance sources own the content. Start with the [writing rules (Chinese)](../agents/writing.md) and [validation rules (Chinese)](../../.agents/skills/validation/SKILL.md). The [reader documentation specification (Chinese)](../specs/arw-reader-documentation/spec.md) also assigns responsibilities among reader documents.

Common check command names are:

~~~text
node arw.mjs text check
node arw.mjs terms check --include .scratch/<NNNN>-<effort-slug>/
node arw.mjs language inspect <repository-relative-path>...
git diff --check -- <changed-path>...
~~~

The validation rules own the exact check scope and interpretation.

### Bootstrap scripts and Installation

Use this route to maintain the separately downloadable bootstrap script, installation payload, global configuration, or uninstall entry point. The [installation long-term specification (Chinese)](../specs/agent-repository-workflow-installation/spec.md) owns behavior and payload responsibility. The [development long-term specification (Chinese)](../specs/agent-repository-workflow-development/spec.md) owns the relationship between source and generated files.

Generate and check the bootstrap script with:

~~~text
node scripts/generate-install-arw.mjs
node scripts/generate-install-arw.mjs --check
~~~

Run the installation entry point from a cloned Source Checkout with `node install.mjs`. Run `node uninstall.mjs` from the ARW installation directory to uninstall.

The public GitHub repository is [pellorao/agent-repository-workflow](https://github.com/pellorao/agent-repository-workflow). The current source-installation route is to clone its `main` branch and run `node install.mjs` from the checkout root. This route requires external Node.js and Git and uses local-source mode with a `<version>-pre` identity. There is no stable tag at the initial publication state. The separately downloaded Bootstrap requires a stable tag and fails when none is available; it does not fall back to `main`. Do not describe a Bootstrap installation as currently available until a stable release exists.

### Workflow Distribution and Platform Projection

Use this route to change actual shared workflow content, distribution configuration, platform projections, or platform-native seeds. The source repository's `.agents/skills/`, managed Agent document regions, canonical Roles, and fixed license files are content sources. `distribution/` is the installation payload produced by synchronization before a release. The [development long-term specification (Chinese)](../specs/agent-repository-workflow-development/spec.md) owns the full responsibility relationship, and the [platform standards (Chinese)](../../.agents/skills/platform-standards/SKILL.md) describe platform formats and target entry points.

Before-release synchronization and production checks use these command names:

~~~text
node scripts/sync-workflow-distribution.mjs review
node scripts/sync-workflow-distribution.mjs review --confirm <additional-skill-references-hash> <skill-reference-normalizations-hash>
node scripts/sync-workflow-distribution.mjs prepare
node scripts/sync-workflow-distribution.mjs apply --plan-digest <plan-digest>
node scripts/check-workflow-distribution.mjs
~~~

The development specification and platform standards define how these commands relate and what inputs they use.

### Upstream Sync

To adopt an update to a fixed external Skill Package, the maintainer explicitly invokes the [`$upstream-sync` Skill (Chinese)](../../.agents/skills/upstream-sync/SKILL.md). The Agent runs `node scripts/upstream-sync.mjs <source> <full-commit-id>` to build a three-way view of the old upstream snapshot, the new upstream version, and the current `.agents/skills/`; the maintainer approves the changes to adopt batch by batch, and the result is recorded in `upstream/sources/<source>/adoptions.md`. Workflow Distribution payloads use a separate pre-release synchronization route.

### Reviewer configuration and capability validation

Use this route to change canonical Reviewer Roles, Reviewer-specific execution, or Reviewer capability scenarios. Roles are in `docs/agents/roles/`. Shared execution and communication rules are in [Reviewer responsibilities (Chinese)](../agents/reviewer.md). The [product background Agent rules (Chinese)](../specs/agent-repository-workflow/spec.md#background-agent-control) and [installation management rules (Chinese)](../specs/agent-repository-workflow-installation/spec.md#background-agent-management) own cross-repository background Agent capacity, connection, and recovery. User model and tier settings are stored in the ARW program directory's `config.json` and the repository's `arw.config.json`. Their format and defaults are in the [Reviewer configuration specification (Chinese)](../specs/agent-repository-workflow-installation/spec.md#reviewer-configuration). Capability tests run when a maintainer explicitly invokes the source-only `$reviewer-capability` Skill. Scenarios are in `tests/fixtures/reviewer-capability/`; build one scenario repository with:

~~~text
node scripts/reviewer-capability.mjs <scenario-directory> <new-target-directory>
~~~

### Cross-operating-system validation environment

Use this route to prove that installation, PATH registration, and `arw workflow init` work on real Windows and Linux systems. The source-only `$release` Skill (`.agents/skills/release/`, Chinese) describes the VM configuration, guest requirements, and snapshot discipline. `scripts/release-vm.mjs` restores a VMware snapshot, copies a candidate Git bundle over SSH, runs `scripts/release-guest-check.mjs` in the guest, and restores the snapshot again.

### Initial GitHub migration

The initial migration transfers the latest `master` file snapshot and approved local changes into a new GitHub `main` with no old commit ancestors. It does not upload old branches, tags, or Git history. The user performs the final snapshot export, creates the new root commit, configures the GitHub `origin`, pushes only `main`, sets it as the default branch, and verifies the remote file tree. The local preparation and instructions do not mean the push has happened. Follow the specific one-time migration instructions for the actual commands, and stop to inspect unexpected remote content rather than overwriting it.

This migration is separate from a version release. It does not create a tag or GitHub Release. The [GitHub migration target](https://github.com/pellorao/agent-repository-workflow) is public, but the initial source migration remains a user-performed operation.

### Stable release

Use this route to validate or publish a stable version. An Agent does it only when the maintainer explicitly invokes the Skill (`$release` in Codex, `/release` in Claude Code), which owns the local checks, VM validation, tag, public Bootstrap check, GitHub Release, and tag recovery. The [release long-term specification (Chinese)](../specs/agent-repository-workflow-release/spec.md) owns the release contract.

## Navigate code by responsibility

Choose the root entry point, a `scripts/` maintenance entry point, or a `lib/` Module by responsibility, then follow imports and tests for that responsibility. Directories are navigation aids, not replacements for Module and Interface contracts in the long-term specifications.

### Root entry points

- `arw.mjs`, `arw`, and `arw.cmd` are product entry points run directly from the source repository.
- `install.mjs` and `uninstall.mjs` are installation entry points run from a cloned checkout.
- `package.json`, `pnpm-lock.yaml`, and `tsconfig.json` respectively hold the product version and development commands, the actual development dependency tree, and strict JavaScript check configuration.
- `config.install.json`, `release-manifest.json`, and `release-validation.json` respectively serve initial global configuration, installation payload, and release validation.
- `AGENTS.md` and `CONTEXT.md` respectively provide the repository's Agent entry rules and durable domain vocabulary.

### scripts

Direct children of `scripts/` are entry points for Source Checkout maintainers or a separately downloadable bootstrap script. They do not become public `arw` subcommands.

| Entry point | Responsibility |
| --- | --- |
| `scripts/check-workflow-distribution.mjs` | Validate production Workflow Distribution payloads and platform projections |
| `scripts/generate-install-arw.mjs` | Generate or check the separately downloadable bootstrap script |
| `scripts/install-arw.mjs` | Separately downloadable bootstrap script that starts installation from a fixed release source |
| `scripts/release-guest-check.mjs` | In a disposable test system, check install, PATH registration, `arw workflow init`, and uninstall |
| `scripts/release-vm.mjs` | Run the guest check in a VMware VM and restore its snapshot |
| `scripts/reviewer-capability.mjs` | Build a Reviewer capability scenario repository and print its launch input |
| `scripts/sync-workflow-distribution.mjs` | Review, prepare, and apply pre-release Workflow Distribution synchronization |
| `scripts/upstream-sync.mjs` | Build the upstream three-way view for the `$upstream-sync` Skill |

### lib

`lib/` contains production implementation and maintenance Modules used only by the Source Checkout. `lib/common/` contains shared capabilities that have no ARW semantics. `lib/arw-common/` contains shared capabilities that depend on ARW semantics and are reused across business areas. Other `lib/<responsibility>/` directories own specific business responsibilities.

The dependency direction allows specific business implementations to depend on `lib/arw-common/` and `lib/common/`. `lib/arw-common/` may depend on `lib/common/`, while `lib/common/` does not depend on ARW semantics or other `lib/` implementations. Root-level files under `lib/` connect multiple responsibilities. Do not automatically add an `index.mjs`, forwarding layer, or new Module Interface for each directory.

### Main directories

- `.agents/skills/` contains the Skill Packages used and maintained by the Source Checkout.
- `distribution/` contains reviewed workflow-distribution installation payloads produced before release.
- `docs/specs/` contains long-term product behavior, `docs/adr/` contains hard-to-reverse decisions, `docs/agents/` contains Agent operating rules, and `docs/manuals/` contains human-reader guides.
- `tests/` is organized by the long-term responsibilities in `lib/`. Root-level tests cover root wiring and cross-responsibility invariants; `tests/helpers/` and `tests/fixtures/` contain shared test infrastructure.
- `.scratch/` contains ARW Artifacts and completion evidence; it is not the Engine's temporary directory.
- `.tmp/` contains short-lived Engine state for the current platform and session, not authoritative Git-managed data.
- `upstream/` contains external-source configuration and adoption records. The three-way view is written to the ignored `.tmp/upstream-sync/`.

## Further reading

- [Project README](../../README.md): project fit, first success, and the main route for users.
- [Agent Repository Workflow long-term specification (Chinese)](../specs/agent-repository-workflow/spec.md): public commands, ARW Artifacts, Agent CLI, Repository Workflow, and product Modules.
- [Development long-term specification (Chinese)](../specs/agent-repository-workflow-development/spec.md): Source Checkout layout, Workflow Distribution, platform projections, and shared Modules.
- [Installation long-term specification (Chinese)](../specs/agent-repository-workflow-installation/spec.md): bootstrap, installation, global configuration, PATH, and uninstall.
- [Release long-term specification (Chinese)](../specs/agent-repository-workflow-release/spec.md): release candidates, Reviewer capabilities, VM validation, tags, and external writes.
- [Reader documentation specification (Chinese)](../specs/arw-reader-documentation/spec.md): README and manual responsibilities and boundaries.
- [Validation rules (Chinese)](../../.agents/skills/validation/SKILL.md): current Agent validation responsibilities and documentation checks.
- [Source Checkout deterministic validation rules (Chinese)](../agents/source-checkout-validation.md): current complete validation entry points and coverage routes.
- [Commit rules (Chinese)](../../.agents/skills/commit/SKILL.md): scope, reviews, and Commit Audit when the user requests a commit.
