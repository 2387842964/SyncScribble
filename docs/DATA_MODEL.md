# SyncScribble Data Model Draft

This document describes the planned PostgreSQL data model. Names may be adjusted during implementation, but the relationships and lifecycle rules should remain stable.

## 1. users

Stores registered users.

Fields:

- `id`: UUID primary key.
- `username`: unique text.
- `passwordHash`: text.
- `email`: nullable text, reserved for future login.
- `phone`: nullable text, reserved for future login.
- `displayName`: nullable text.
- `avatarUrl`: nullable text.
- `createdAt`: timestamp.
- `updatedAt`: timestamp.

Rules:

- `username` is globally unique.
- Password must never be stored in plaintext.

## 2. rooms

Stores active and historical room records.

Fields:

- `id`: UUID primary key.
- `roomId`: unique short ID among non-destroyed rooms.
- `roomName`: display name.
- `visibility`: enum, `public` or `private`.
- `ownerId`: foreign key to `users.id`.
- `maxMembers`: integer, max 20.
- `status`: enum, `active`, `destroying`, `destroyed`.
- `createdAt`: timestamp.
- `updatedAt`: timestamp.
- `destroyWarningAt`: nullable timestamp.
- `destroyedAt`: nullable timestamp.

Rules:

- `roomId` can be reused after room destruction.
- Public active rooms appear in the lobby.
- Private active rooms do not appear in the lobby.

## 3. room_members

Stores membership and join order.

Fields:

- `id`: UUID primary key.
- `roomId`: foreign key to `rooms.id`.
- `userId`: foreign key to `users.id`.
- `role`: enum, `owner` or `member`.
- `joinOrder`: integer.
- `isOnline`: boolean.
- `joinedAt`: timestamp.
- `lastSeenAt`: timestamp.
- `leftAt`: nullable timestamp.

Rules:

- A user can have only one active room membership at a time.
- Ownership transfers to the next eligible online member by `joinOrder`.

## 4. room_permissions

Stores per-user room permission overrides.

Fields:

- `id`: UUID primary key.
- `roomId`: foreign key to `rooms.id`.
- `userId`: foreign key to `users.id`.
- `canChat`: boolean.
- `canSendImages`: boolean.
- `canDraw`: boolean.
- `canUseLaserPointer`: boolean.
- `canClearCanvas`: boolean.
- `canUndoRedo`: boolean.
- `updatedBy`: foreign key to `users.id`.
- `updatedAt`: timestamp.

Default values:

- All permissions true for normal members.

Rules:

- Owner can update permissions.
- Disabled users can still observe room content.

## 5. room_bans

Stores kick and ban restrictions.

Fields:

- `id`: UUID primary key.
- `roomId`: foreign key to `rooms.id`.
- `userId`: foreign key to `users.id`.
- `reason`: nullable text.
- `banType`: enum, `temporary` or `permanent`.
- `banUntil`: nullable timestamp.
- `createdBy`: foreign key to `users.id`.
- `createdAt`: timestamp.
- `revokedAt`: nullable timestamp.

Rules:

- Temporary ban expires after `banUntil`.
- Permanent ban has `banType = permanent`.
- Bans are deleted when room is destroyed unless audit retention is added.

## 6. room_invites

Persistent record for invites, while actual TTL validation can be in Redis.

Fields:

- `id`: UUID primary key.
- `roomId`: foreign key to `rooms.id`.
- `tokenHash`: text.
- `createdBy`: foreign key to `users.id`.
- `expiresAt`: timestamp.
- `usedCount`: integer.
- `revokedAt`: nullable timestamp.
- `createdAt`: timestamp.

Rules:

- Default TTL is 120 seconds.
- Store token hash, not raw token.
- Expired token cannot be used.

## 7. chat_messages

Stores group and private chat messages.

Fields:

- `id`: UUID primary key.
- `roomId`: foreign key to `rooms.id`.
- `senderId`: foreign key to `users.id`.
- `messageType`: enum, `text` or `image`.
- `scope`: enum, `group` or `private`.
- `receiverId`: nullable foreign key to `users.id`.
- `text`: nullable text.
- `uploadId`: nullable foreign key to `uploads.id`.
- `createdAt`: timestamp.
- `deletedAt`: nullable timestamp.

Rules:

- Group messages have `receiverId = null`.
- Private messages require `receiverId`.
- Private messages are visible only to sender and receiver.
- Messages are deleted when room is destroyed.

## 8. uploads

Stores uploaded image metadata.

Fields:

- `id`: UUID primary key.
- `roomId`: foreign key to `rooms.id`.
- `uploaderId`: foreign key to `users.id`.
- `storagePath`: text.
- `publicPath`: text or internal file ID.
- `mimeType`: text.
- `sizeBytes`: integer.
- `width`: nullable integer.
- `height`: nullable integer.
- `createdAt`: timestamp.
- `deletedAt`: nullable timestamp.

Rules:

- File content is stored on disk volume.
- Database stores metadata only.
- Access must be authorized by room membership and private chat visibility.

## 9. canvas_objects

Stores current drawable object state.

Fields:

- `id`: UUID primary key.
- `roomId`: foreign key to `rooms.id`.
- `ownerId`: foreign key to `users.id`.
- `objectType`: enum, `stroke`, `eraser`, `line`, `rectangle`, `ellipse`, `arrow`, `text`, `image`, `background`.
- `data`: jsonb.
- `style`: jsonb.
- `zIndex`: integer.
- `isDeleted`: boolean.
- `createdAt`: timestamp.
- `updatedAt`: timestamp.
- `deletedAt`: nullable timestamp.

Rules:

- Undo and redo operate only on objects owned by current user.
- Owner cannot modify another user's objects unless a later explicit feature is added.

## 10. canvas_operations

Stores append-only canvas operation history.

Fields:

- `id`: UUID primary key.
- `roomId`: foreign key to `rooms.id`.
- `userId`: foreign key to `users.id`.
- `objectId`: nullable foreign key to `canvas_objects.id`.
- `operationType`: enum.
- `payload`: jsonb.
- `clientOperationId`: text.
- `createdAt`: timestamp.

Recommended operation types:

- `object.create`
- `object.update`
- `object.delete`
- `object.restore`
- `canvas.clear`
- `background.set`
- `background.clear`
- `snapshot.create`

Rules:

- Use `clientOperationId` for idempotency.
- Operations are room-scoped.
- Operations are deleted when room is destroyed.

## 11. canvas_snapshots

Stores compact room canvas state.

Fields:

- `id`: UUID primary key.
- `roomId`: foreign key to `rooms.id`.
- `operationId`: foreign key to latest included `canvas_operations.id`.
- `data`: jsonb.
- `createdAt`: timestamp.

Rules:

- Snapshot every configured number of operations.
- Default interval: 500 operations.
- Room load uses latest snapshot plus later operations.

## 12. undo_stacks

Optional table for persisted undo state.

Fields:

- `id`: UUID primary key.
- `roomId`: foreign key to `rooms.id`.
- `userId`: foreign key to `users.id`.
- `undoStack`: jsonb.
- `redoStack`: jsonb.
- `updatedAt`: timestamp.

Alternative:

- Derive undo and redo from `canvas_operations` and object state.

Implementation can choose the simpler approach after prototyping object operations.

## 13. Redis Key Plan

All keys must use prefix:

- `syncscribble:*`

Recommended keys:

- `syncscribble:session:{sessionId}`
- `syncscribble:invite:{token}`
- `syncscribble:presence:user:{userId}`
- `syncscribble:presence:room:{roomId}`
- `syncscribble:socket:{socketId}`
- `syncscribble:room-cleanup:{roomUuid}`
- `syncscribble:rate-limit:{scope}:{id}`

Never use:

- `FLUSHDB`
- `FLUSHALL`
- Unprefixed keys

