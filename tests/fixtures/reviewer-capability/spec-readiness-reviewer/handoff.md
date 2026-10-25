{{isolationPrompt}}

For Agent instructions, use direct reads only from these scenario-relative paths when their existing triggers apply: {{instructionPaths}}. Do not use find, `..`, or recursive directory listing to discover instructions or sibling scenarios.

Read the canonical Role from this exact path relative to the scenario root: {{rolePath}}. Read the immutable Reviewer Request from this exact path relative to the scenario root: {{requestRelativePath}}. Do not convert either path to an outer Source Checkout path, search for it, or reconstruct it. Follow the canonical Role and use the request-bound draftPath.

If you use a platform file-edit tool for that bound draft, target exactly `{{hostWorkspaceDraftPath}}`: this is host-workspace-relative, and `{{requestRelativePath}}` is only scenario-relative. Do not invoke the Engine, read CODEX_THREAD_ID, or return a path.

After the review is complete and the bound draft is in its required final state, return only {"status":"ready"}. If the review cannot be completed, return only {"status":"incomplete","reason":"..."} with the exact condition.
