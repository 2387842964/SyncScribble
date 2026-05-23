# SyncScribble Product Requirements

## 1. Product Direction

SyncScribble will evolve from a single shared drawing board into a room-based real-time collaborative whiteboard application.

The target product is a tool-oriented whiteboard with:

- Account registration and login.
- Public and private rooms.
- Shareable room links.
- Room-level drawing collaboration.
- Group chat and private chat.
- Room member management.
- Persistent room data across server restarts.
- Object-based canvas features such as undo, redo, shapes, text, and later layers.

## 2. Confirmed Core Decisions

- Login uses username and password in the first version.
- User records should reserve fields for phone and email for future login methods.
- Login session lasts 7 days.
- Room identity uses a unique custom `roomId`.
- Room display name uses `roomName` and does not need to be unique.
- Public rooms appear in the lobby.
- Private rooms do not appear in the lobby, but users can join if they know the `roomId` or have a valid invite link.
- Strict invite-only private rooms are reserved for future expansion.
- Invite links use an `inviteToken` with a default 2-minute TTL.
- A room owner cannot join another room while their current room exists.
- If the owner leaves, ownership transfers to the next eligible online member by join order.
- If a room has no non-owner participant for a configured duration, default 2 hours, it is destroyed.
- Room destruction removes room data and releases the `roomId`.
- Server restart or redeploy must not lose active room data.
- Canvas, chat messages, permissions, bans, and member state persist while the room exists.
- When a room is destroyed, its canvas and chat history are deleted.
- Undo and redo can only affect the current user's own canvas objects.
- The owner also can only undo and redo their own canvas objects.
- Chat private messages are visible only to sender and receiver.
- Private chat is only allowed between users in the same room.
- Room members can see content even if some operation permissions are disabled.

## 3. Roles

### Guest Visitor

Not logged in. Can only see login/register pages.

### Logged-in User

Can:

- Create a room.
- Join a room if not already active in another room.
- Use lobby room list.
- Use invite links.

### Room Owner

The room owner can:

- Generate invite links.
- Set room visibility.
- Kick users.
- Ban users for a duration.
- Disable specific permissions for room members.
- Close the room.
- Transfer ownership implicitly when leaving.

The room owner cannot:

- Undo or redo another user's canvas actions.
- Read private messages between other users.

### Room Member

A normal room member can:

- Draw if drawing is allowed.
- Chat if chat is allowed.
- Send images if image sending is allowed.
- Clear the canvas if clear permission is allowed.
- Undo and redo their own canvas objects.
- Leave the room.

## 4. Authentication

### Registration

Fields:

- `username`
- `password`

Reserved future fields:

- `email`
- `phone`

Validation:

- `username`: 3-20 characters.
- Allowed username characters: letters, numbers, underscore.
- `username` must be globally unique.
- `password`: 6-64 characters.
- Passwords must be stored as hashes, never plaintext.

### Login

Login with:

- `username`
- `password`

Session:

- Use HttpOnly cookie.
- Session TTL is 7 days.
- Session storage should be Redis-backed.

### Logout

Logout invalidates the current session.

If the user is in a room:

- Mark the user offline.
- If the user is the owner, transfer owner according to room rules.

## 5. Room Model

### Room Fields

- `roomId`: unique custom short ID used for joining and sharing.
- `roomName`: display name, not unique.
- `visibility`: `public` or `private`.
- `ownerId`: current room owner.
- `maxMembers`: selected at room creation.
- `createdAt`
- `updatedAt`
- `destroyAt`, nullable.

### Room ID Rules

Recommended validation:

- 4-24 characters.
- Lowercase letters, numbers, hyphen, underscore.
- Normalize to lowercase.
- Must be unique among active rooms.
- Can be reused after the old room is destroyed.

### Room Name Rules

Recommended validation:

- 1-40 characters.
- Can contain Chinese, English, numbers, spaces, and common symbols.
- Does not need to be unique.

### Room Capacity

The owner selects capacity at creation.

Recommended options:

- 2
- 5
- 10
- 20

Hard maximum:

- 20 members.

## 6. Lobby

The lobby shows real-time public room information:

- Room name.
- Room ID.
- Current online count.
- Max members.
- Owner display name.
- Visibility marker.
- Created time or active time.

Lobby does not show private rooms.

Lobby updates in real time when:

- A public room is created.
- A public room is destroyed.
- Online count changes.
- Room visibility changes.

## 7. Joining Rooms

Users can join by:

- Clicking a public room from the lobby.
- Entering `roomId`.
- Opening an invite link.

Join constraints:

- A user cannot join more than one room at the same time.
- If already in a room, the user must leave the current room first.
- If room is full, join is rejected.
- If user is banned from the room, join is rejected.
- If private room is not invite-only, known `roomId` is enough to join.
- Invite token must be valid if the join path uses an invite link.

## 8. Invite Links

Invite links include:

- `roomId`
- `inviteToken`

Default token TTL:

- 120 seconds.

Owner can regenerate invite links.

Expired invite links:

- Cannot be used.
- Do not destroy the room.
- Can be regenerated.

## 9. Room Lifecycle

### Creation

When a room is created:

- Creator becomes owner.
- Creator joins automatically.
- `roomId` is reserved.
- Room data is persisted.
- Public rooms appear in the lobby.

### Owner Leaves

If owner leaves:

- Transfer ownership to the next online member by join order.
- If no other online member exists, room remains but starts no-guest cleanup timer.

### No-Guest Cleanup

If a room has no non-owner participant continuously for the configured duration:

- Default: 2 hours.
- Room is destroyed.
- Room data is deleted.
- `roomId` becomes available.

### Destroy Warning

Before room destruction:

- Notify remaining online users.
- Default warning time: 60 seconds.
- Warning time must be configurable.

### Destruction

Destroy room when:

- Cleanup timeout is reached.
- Owner closes room.

Destroying a room deletes:

- Room record or marks it destroyed.
- Canvas operations.
- Canvas snapshots.
- Chat messages.
- Invite tokens.
- Member permissions.
- Ban records, unless audit retention is later added.

## 10. Permissions

Permissions are per room per user.

Recommended permission flags:

- `canChat`
- `canSendImages`
- `canDraw`
- `canUseLaserPointer`
- `canClearCanvas`
- `canUndoRedo`

Owner can toggle permissions for a member.

Permission-disabled users:

- Can still view the room.
- Can still see canvas updates.
- Can still see allowed chat channels.
- Cannot perform disabled operations.

## 11. Kick and Ban

Owner can:

- Kick a user immediately.
- Ban a user from rejoining for a duration.
- Permanently ban a user.

Preset ban durations:

- 10 minutes.
- 1 hour.
- 24 hours.
- Permanent.

Custom ban:

- Numeric duration.
- Unit: minutes, hours, days.

Ban checks happen before joining.

## 12. Chat

### Group Chat

All room members can see group messages unless chat viewing restrictions are added later.

Message types:

- Text.
- Image.

Text validation:

- Default max length: 2000 characters.

Image validation:

- Default max image size: 5 MB.
- Allowed formats: PNG, JPEG, WebP, GIF.
- Images are stored as files, not database blobs.

### Private Chat

Private chat constraints:

- Sender and receiver must be in the same room.
- Room owner cannot see private chats between other members.
- Private messages are saved while the room exists.
- Private messages are deleted when the room is destroyed.

## 13. Canvas Requirements

### Existing Capabilities to Preserve

- Pen.
- Eraser.
- Brush size.
- Brush opacity.
- Color picker.
- Background image.
- Zoom and pan.
- Save as PNG.
- Clear canvas.
- Real-time drawing sync.

### Required Upgrade

Canvas should move toward object-based data.

Each drawable entity should become a canvas object:

- Stroke.
- Eraser stroke.
- Line.
- Rectangle.
- Ellipse.
- Arrow.
- Text.
- Background image.

Object-based data enables:

- Own-object undo and redo.
- Selection.
- Move.
- Delete.
- Future layers.
- Snapshot and incremental operation persistence.

### First-Version Canvas Enhancements

P0:

- Room-isolated canvas.
- Persistent canvas history.
- Snapshot plus incremental operations.
- Undo and redo for own objects.
- Permission checks for draw, clear, undo, redo.
- Clear canvas with confirmation.
- Export PNG.

P1:

- Shape tools: line, rectangle, ellipse, arrow.
- Text tool.
- Selection tool for own objects.
- Move own objects.
- Delete own objects.
- Laser pointer.
- Online user list with drawing status.

P2:

- Layers.
- Multi-object selection.
- Object locking.
- Grid and snapping.
- Export SVG/PDF.
- Image paste onto canvas.
- Sticky notes.
- Version restore.
- Infinite canvas.

## 14. Laser Pointer

Laser pointer is a temporary collaboration signal.

Rules:

- Does not persist in canvas history.
- Broadcasts only in real time.
- Has user identity and color.
- Disappears after a short TTL.
- Can be disabled by owner through `canUseLaserPointer`.

## 15. Online Presence

Room sidebar should show:

- Online members.
- Owner marker.
- Muted or restricted status.
- Current drawing status.
- Optional user color.

Real-time updates:

- User joins.
- User leaves.
- User reconnects.
- Owner changes.
- Permissions change.

## 16. Configurable Values

These values must be easy to change:

- `SESSION_TTL_DAYS = 7`
- `INVITE_TOKEN_TTL_SECONDS = 120`
- `ROOM_NO_GUEST_TTL_HOURS = 2`
- `ROOM_DESTROY_WARNING_SECONDS = 60`
- `ROOM_MAX_MEMBERS = 20`
- `CHAT_TEXT_MAX_LENGTH = 2000`
- `CHAT_IMAGE_MAX_SIZE_MB = 5`
- `CANVAS_SNAPSHOT_OP_INTERVAL = 500`
- `REDIS_KEY_PREFIX = syncscribble`

## 17. Out of Scope for First Implementation

- Phone login.
- Email login.
- OAuth login.
- Payment or billing.
- Multi-server scaling.
- End-to-end encrypted private chat.
- Strict invite-only private room mode.
- Infinite canvas.
- Full layer editor.

