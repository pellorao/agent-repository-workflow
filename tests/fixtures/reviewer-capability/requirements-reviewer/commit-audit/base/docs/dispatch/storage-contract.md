# Manifest Store Contract

- `store.put(manifest, options)` resolves only after the exact supplied manifest object is durably stored.
- A successful call resolves to the supplied manifest object itself.
- The `announce` option only labels the storage operation and never sends an announcement.
- `store.get(id)` resolves to a new copy of the stored manifest with that ID, or to `undefined`.
- `store.remove(manifest)` removes a stored manifest only when given that exact stored object; any other value removes nothing.

# Plan Store Contract

- `store.renameTemporary()` either replaces the stored plan with the temporary bytes or rejects; after it rejects, the temporary bytes stay in place and are locked.
- `store.discardTemporary()` closes the temporary write and deletes its bytes.
- While the temporary bytes are locked, `store.discardTemporary()` instead only closes the temporary write and keeps the bytes.
- `store.removeTemporary()` deletes the temporary bytes, including locked bytes.
- `store.writeTemporary(bytes)` resolves only after the temporary bytes are durable.
