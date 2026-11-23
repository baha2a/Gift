# Security Specification (`firestore.rules`)

## 1. Data Invariants
1. Only the verified application owner (`ba.aldeen@gmail.com` with `email_verified == true`, or a verified admin document in `/admins/{uid}`) may create, update, or delete `/gifts/{giftId}` and `/gifts/{giftId}/chunks/{chunkId}`.
2. A `/gifts/{giftId}/chunks/{chunkId}` document cannot exist without a valid parent `/gifts/{giftId}` document owned by `request.auth.uid`.
3. Every `id`, `giftId`, and `chunkId` path parameter must match `^[a-zA-Z0-9_-]+$` and be at most 128 characters.
4. Public recipients can read (`get`) a gift and its chunks ONLY when `status == 'ready'`, and public `list` on `/gifts` is strictly constrained to `resource.data.status == 'ready' && resource.data.isPrimary == true`.
5. `ownerId` and `createdAt` are immutable after creation, and `createdAt`/`updatedAt` must equal `request.time`.
6. Each `GiftChunk.payload` must be `bytes` with `size() > 0 && size() <= 750000`.

## 2. Adversarial "Dirty Dozen" Payloads (Expected: `PERMISSION_DENIED`)
1. Unauthenticated `create` on `/gifts/test1` -> DENIED (not signed in / not owner).
2. Signed-in non-owner (`other@example.com`, `email_verified: true`) `create` on `/gifts/test1` -> DENIED.
3. Spoofed unverified owner (`ba.aldeen@gmail.com`, `email_verified: false`) `create` on `/gifts/test1` -> DENIED.
4. Owner creates `/gifts/test1` with `ownerId` set to someone else's UID -> DENIED.
5. Owner creates `/gifts/test1` with shadow field `isAdmin: true` -> DENIED (`keys().hasOnly(...)`).
6. Owner creates `/gifts/test1` with `title` exceeding 100 chars -> DENIED.
7. Owner creates `/gifts/test1` with client-forged `createdAt` (`!= request.time`) -> DENIED.
8. Owner updates `/gifts/test1` attempting to mutate `ownerId` or `createdAt` -> DENIED.
9. Unauthenticated user attempts `delete` on `/gifts/test1` -> DENIED.
10. Unauthenticated user attempts `get` on `/gifts/uploading1` where `status == 'uploading'` -> DENIED.
11. Unauthenticated user attempts blanket `list` on `/gifts` without `status == 'ready' && isPrimary == true` -> DENIED.
12. Owner creates `/gifts/missing_parent/chunks/0` when parent `/gifts/missing_parent` does not exist -> DENIED (`exists(...)`).
