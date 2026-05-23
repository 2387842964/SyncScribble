# SyncScribble Realtime Events

This document defines the planned REST and Socket.IO event boundary.

## 1. Principles

- REST handles stable request-response operations.
- Socket.IO handles real-time room activity.
- Every socket event must validate authentication.
- Every room event must validate membership.
- Every privileged event must validate room owner or permission.
- Server is authoritative.
- Client-side permission checks are only UI hints.

## 2. REST API Draft

### Auth

`POST /api/auth/register`

Request:

- `username`
- `password`

Response:

- User profile.
- Session cookie.

`POST /api/auth/login`

Request:

- `username`
- `password`

Response:

- User profile.
- Session cookie.

`POST /api/auth/logout`

Response:

- Success.

`GET /api/auth/me`

Response:

- Current user or unauthenticated.

### Rooms

`GET /api/rooms/public`

Returns public lobby list.

`POST /api/rooms`

Request:

- `roomId`
- `roomName`
- `visibility`
- `maxMembers`

Response:

- Room info.

`POST /api/rooms/:roomId/join`

Request:

- Optional `inviteToken`.

Response:

- Room initial state.

`POST /api/rooms/:roomId/leave`

Response:

- Success and optional owner transfer info.

`POST /api/rooms/:roomId/invites`

Owner-only.

Response:

- Invite link.
- Expiry time.

### Uploads

`POST /api/rooms/:roomId/uploads/chat-image`

Request:

- Multipart image file.

Response:

- Upload ID.
- Authorized image URL.

## 3. Socket Connection

Client connects with session cookie.

Server checks:

- Valid session.
- User exists.

Server rejects if unauthenticated.

## 4. Socket Room Join

After REST join succeeds, client emits:

`room:join`

Payload:

- `roomId`

Server:

- Validates membership.
- Adds socket to Socket.IO room.
- Emits initial room realtime state if needed.

## 5. Presence Events

`presence:user-joined`

Broadcast when a user joins.

Payload:

- `roomId`
- `user`
- `onlineCount`

`presence:user-left`

Broadcast when a user leaves or disconnects.

Payload:

- `roomId`
- `userId`
- `onlineCount`

`presence:owner-changed`

Payload:

- `roomId`
- `newOwnerId`
- `previousOwnerId`

`presence:drawing-status`

Payload:

- `roomId`
- `userId`
- `isDrawing`

## 6. Chat Events

`chat:send`

Client payload:

- `roomId`
- `scope`: `group` or `private`
- `receiverId`, required for private messages
- `messageType`: `text` or `image`
- `text`, for text messages
- `uploadId`, for image messages
- `clientMessageId`

Server checks:

- User is room member.
- `canChat` for text messages.
- `canSendImages` for image messages.
- Receiver is in same room for private messages.

Server emits:

`chat:message`

Payload:

- Saved message record.

Group message target:

- Entire room.

Private message target:

- Sender sockets.
- Receiver sockets.

## 7. Canvas Events

### Object Operations

`canvas:operation`

Client payload:

- `roomId`
- `clientOperationId`
- `operationType`
- `objectId`
- `payload`

Server checks:

- User is room member.
- User has required permission.
- User owns target object for update/delete/undo/redo.
- Operation is idempotent by `clientOperationId`.

Server persists operation, updates object state, then emits:

`canvas:operation-applied`

Payload:

- `serverOperationId`
- `clientOperationId`
- `roomId`
- `userId`
- `operationType`
- `objectId`
- `payload`
- `createdAt`

### Undo and Redo

`canvas:undo`

Payload:

- `roomId`

Server:

- Finds latest undoable operation for current user.
- Applies inverse operation.
- Emits `canvas:operation-applied`.

`canvas:redo`

Payload:

- `roomId`

Server:

- Redoes latest redoable operation for current user.
- Emits `canvas:operation-applied`.

### Clear Canvas

`canvas:clear`

Payload:

- `roomId`

Server checks:

- `canClearCanvas`.

Server emits:

- `canvas:cleared`

Note:

- Clear canvas is allowed for all users by default.
- Owner can revoke this permission from specific users.

## 8. Laser Pointer Events

`laser:move`

Payload:

- `roomId`
- `x`
- `y`
- `color`

Server checks:

- User is room member.
- `canUseLaserPointer`.

Server broadcasts:

`laser:move`

Payload:

- `roomId`
- `userId`
- `x`
- `y`
- `color`
- `expiresAt`

Laser pointer events are not persisted.

## 9. Permission Events

`permissions:update`

Owner-only.

Payload:

- `roomId`
- `targetUserId`
- Permission patch.

Server emits:

`permissions:updated`

Payload:

- `roomId`
- `targetUserId`
- Current permissions.

## 10. Moderation Events

`member:kick`

Owner-only.

Payload:

- `roomId`
- `targetUserId`
- Optional `banDuration`
- Optional `reason`

Server emits:

- `member:kicked` to target user.
- `presence:user-left` to room.

`member:ban`

Owner-only.

Payload:

- `roomId`
- `targetUserId`
- `duration`
- `reason`

Server emits:

- `member:banned` to target user.

## 11. Invite Events

Invite generation should be REST-first. Socket can be used to notify room members:

`invite:created`

Payload:

- `roomId`
- `expiresAt`

Do not broadcast raw invite token to the full room unless intended.

## 12. Room Destruction Events

`room:destroy-warning`

Payload:

- `roomId`
- `destroyAt`
- `secondsRemaining`

`room:destroyed`

Payload:

- `roomId`
- `reason`

After `room:destroyed`:

- Clients leave the room UI.
- Public lobby removes the room.
- `roomId` becomes reusable.

## 13. Error Format

Socket error payload:

- `code`
- `message`
- Optional `details`

Examples:

- `AUTH_REQUIRED`
- `ROOM_NOT_FOUND`
- `ROOM_FULL`
- `PERMISSION_DENIED`
- `USER_BANNED`
- `INVALID_INVITE`
- `RATE_LIMITED`
- `OBJECT_NOT_OWNED`

