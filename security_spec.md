# Firestore Security Specification - Cansu & Murat

## 1. Data Invariants
- A **Place** must have a non-empty name.
- The `ownerId` of a place must match the authenticated user's UID.
- The `createdAt` timestamp must be set by the server on creation.
- The `visitedAt` timestamp must be set by the server when `visited` becomes true.
- Photos are limited to at most 6 per place.
- Ratings must be between 1 and 5 (only applicable when visited).
- Notes are optional but must be string and reasonably sized.

## 2. The "Dirty Dozen" Payloads (Red Team Tests)

1. **Identity Spoofing**: Create a place with `ownerId` set to another user's UID.
2. **Shadow Field Injection**: Update a place with a field not in the schema (e.g., `isAdmin: true`).
3. **Rating Poisoning**: Set a rating of `99`.
4. **Photo Exhaustion**: Add 50 photo URLs to a single place.
5. **Timeline Hijacking**: Update `visitedAt` to a future date manually from the client.
6. **Orphaned Writes**: Create a place without a `name`.
7. **Type Mismatch**: Send `photos: "not-an-array"`.
8. **Resource Poisoning**: Use a 1MB string for the `name` field.
9. **State Shortcutting**: Mark as `visited: true` but don't provide a `visitedAt` from server.
10. **ID Hijacking**: Try to delete a place that belongs to another `ownerId`.
11. **Immutable Breach**: Try to change the `createdAt` date on an existing place.
12. **Blanket Read Attack**: Try to list all places without filtering by `ownerId` (if rules are list-restricted).

## 3. Red Team Evaluation Table

| Collection | Identity Spoofing | State Shortcutting | Value Poisoning | Outcome |
|------------|------------------|-------------------|-----------------|---------|
| /places/   | Blocked (isOwner) | Blocked (status)   | Blocked (schema)| SECURE  |

