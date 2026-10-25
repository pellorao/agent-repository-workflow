# Manifest Store Contract

- `store.put(manifest, options)` resolves only after the exact supplied manifest object is durably stored.
- A successful call returns that same stored manifest object.
- The `announce` option only labels the storage operation and never sends an announcement.
