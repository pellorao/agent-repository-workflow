# Source Rules

Terms used in these rules:

- A feature is a directory under `src/` other than `src/platform/`.
- Inside a feature, a file named `*-service.mjs` is a service module, a file named `*-store.mjs` is a store module, and every other file is a rule module. Files under `src/platform/` are platform modules.

1. Modules must use named exports. Default exports are forbidden.
2. Only store modules and platform modules may import Node.js built-in modules, and those imports must use the `node:` specifier prefix.
3. Array and plain-object values exported directly from a module must be frozen before export.
4. Errors:
   1. Rule modules must not catch errors; they let errors propagate to their caller. Service, store and platform modules may catch errors.
   2. An error that replaces a caught error must preserve the caught error as its `cause`.
   3. A store or platform module may catch only to keep its internal write queue usable after a failed write. The promise or value it returns to its caller must still reject or throw with the original error.
5. Exported functions must not mutate caller-supplied objects or arrays. Records returned by an injected store count as caller-supplied: build a changed copy and save the copy. Exported functions may call methods of injected stores and other stateful dependencies according to their interface contracts.
6. Current time:
   1. Only service modules read the current time, and only by calling their injected `now` function. Do not read the clock with `Date.now()` or an argument-less `new Date()`.
   2. Rule modules receive instants (numbers) as parameters, never a `now` function.
   3. A service function calls `now` at most once per call and passes that instant to everything that needs the current time. A service function may instead pass its `now` function on to another exported service function, which then reads it under this rule.
7. Imports between directories:
   1. A feature module may import modules of its own feature and platform modules.
   2. A feature module may also import rule modules of another feature, but never service or store modules of another feature.
   3. Platform modules must not import feature modules.
   4. When `docs/agents/writing.md` asks for an existing capability to be reused but this rule forbids importing the module that holds it, move the capability to a platform module first. This rule takes precedence over a direct import.
