# Source Rules

1. Every exported function in this directory tree must start with the exact `reviewerCapability` prefix.
2. Modules in this directory tree must use named exports. Default exports are forbidden.
3. Imports of Node.js built-in Modules must use the `node:` specifier prefix.
4. Array and plain-object values exported directly from a Module must be frozen before export.
5. Exported functions that return a boolean must start with `reviewerCapabilityIs`, `reviewerCapabilityHas`, or `reviewerCapabilityCan`.
6. An error that replaces a caught error must preserve the caught error as its `cause`.
7. Exported functions must not directly mutate caller-supplied data objects or arrays. They may invoke methods on injected stateful dependencies according to their interface contracts, but must not directly modify those dependencies' internal state.
8. Current time must come from an explicitly injected `now` function. Direct `Date.now()` and `new Date()` calls are forbidden.
