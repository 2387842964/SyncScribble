# SyncScribble Architecture Plan

## 1. Recommended Stack

Frontend:

- React.
- Vite.
- TypeScript.
- React Router.
- Zustand.
- Socket.IO Client.
- Canvas engine implemented outside React render loops.

Backend:

- Node.js.
- TypeScript.
- NestJS.
- Socket.IO Gateway.
- Prisma ORM.
- PostgreSQL.
- Redis.

Deployment:

- Docker Compose.
- Nginx reverse proxy.
- PostgreSQL and Redis may be reused from existing Docker services if isolated correctly.

## 2. Why This Stack

The project is real-time and browser-heavy. Node.js remains the best fit because:

- Existing project already uses Express and Socket.IO.
- Socket.IO is mature in Node.
- Frontend and backend can share TypeScript types.
- NestJS provides structure for a larger application.
- Migration cost is lower than rewriting in Java or Python.

React is recommended because:

- The product is becoming stateful and UI-heavy.
- Lobby, room sidebar, chat, permissions, modals, and toolbars need component structure.
- Vite keeps the build simple.

PostgreSQL is recommended because:

- Room, chat, permission, and canvas data need reliable persistence.
- `jsonb` is useful for canvas objects and operation payloads.
- Transactions matter for room join, owner transfer, and cleanup.

Redis is recommended because:

- Session TTL fits Redis well.
- Invite token TTL fits Redis well.
- Online presence is short-lived.
- Socket.IO adapter can use Redis later for multi-instance scaling.
- Rate limiting can use Redis counters.

## 3. High-Level Components

### Web App

Responsibilities:

- Login and register UI.
- Lobby.
- Room creation and join flows.
- Whiteboard UI.
- Chat UI.
- Member and permission management UI.

### API Server

Responsibilities:

- Authentication.
- Session handling.
- Room CRUD.
- Invite creation and validation.
- File upload.
- Permission validation.
- Persistence.
- Cleanup jobs.
- Socket.IO events.

### PostgreSQL

Stores durable data:

- Users.
- Rooms.
- Members.
- Permissions.
- Bans.
- Chat messages.
- Canvas objects.
- Canvas operations.
- Canvas snapshots.

### Redis

Stores short-lived or hot data:

- Sessions.
- Invite tokens.
- Online presence.
- Socket connection mapping.
- Room cleanup timers.
- Rate limit keys.
- Permission cache.

### Nginx

Responsibilities:

- Serve frontend build or route to web container.
- Proxy `/api`.
- Proxy `/socket.io`.
- Serve uploaded files through authenticated backend routes or internal redirects.

## 4. Deployment Isolation

The server already has Docker-hosted PostgreSQL and Redis used by another project, Sub2API. SyncScribble must not modify or pollute Sub2API data.

### PostgreSQL Isolation

Preferred approach:

- Use the existing PostgreSQL container.
- Create a new database: `syncscribble`.
- Create a new user: `syncscribble_user`.
- Grant only the needed privileges on the `syncscribble` database.
- Do not change existing PostgreSQL passwords.
- Do not modify Sub2API tables, schemas, users, or database.

Alternative approach:

- Run a dedicated `syncscribble-postgres` container.
- Use this if existing PostgreSQL access or permissions are unclear.

### Redis Isolation

Preferred approach:

- Use existing Redis container.
- Use key prefix: `syncscribble:*`.
- Optionally use a dedicated Redis logical DB index if available.
- Never run `FLUSHDB` or `FLUSHALL`.
- Never change Redis password or global config without confirmation.

Alternative approach:

- Run a dedicated `syncscribble-redis` container.
- Use this if the existing Redis deployment is sensitive or shared too broadly.

## 5. Docker Compose Shape

Recommended project services:

- `syncscribble-api`
- `syncscribble-web`
- `syncscribble-nginx`

External dependencies:

- Existing PostgreSQL container.
- Existing Redis container.

Volumes:

- `syncscribble_uploads`: chat images and future uploaded assets.
- Optional `syncscribble_logs`.

Networks:

- A project network for SyncScribble services.
- External network attachment to reach PostgreSQL and Redis if they run in another compose project.

## 6. Backend Module Layout

Recommended NestJS modules:

- `AuthModule`
- `UsersModule`
- `RoomsModule`
- `InvitesModule`
- `MembersModule`
- `PermissionsModule`
- `ChatModule`
- `CanvasModule`
- `UploadsModule`
- `PresenceModule`
- `RealtimeModule`
- `CleanupModule`

## 7. Frontend Layout

Recommended routes:

- `/login`
- `/register`
- `/lobby`
- `/rooms/create`
- `/rooms/:roomId`
- `/join/:roomId`
- `/join/:roomId/:inviteToken`

Recommended UI areas in room page:

- Top room bar.
- Left whiteboard toolbar.
- Center canvas viewport.
- Right member and chat panel.
- Owner management drawer.
- Invite dialog.

## 8. API and Socket Split

Use REST for stable request-response actions:

- Register.
- Login.
- Logout.
- Get current session.
- Create room.
- Join room.
- Leave room.
- Generate invite.
- Upload image.
- Fetch initial room data.

Use Socket.IO for real-time room activity:

- Drawing.
- Canvas operations.
- Laser pointer.
- Chat.
- Private chat.
- Presence.
- Permissions.
- Kicks and bans.
- Owner transfer.
- Room destruction.

## 9. Authentication Strategy

Recommended:

- HttpOnly cookie session.
- Session ID stored in Redis.
- User ID stored in session payload.
- 7-day TTL.
- CSRF protection for state-changing REST routes if cookie auth is used.

Socket.IO authentication:

- Read session cookie during handshake.
- Reject unauthenticated sockets.
- Store `socketId -> userId` in Redis or server memory.

## 10. Canvas Persistence Strategy

Use both objects and operations.

Canvas objects:

- Current state of drawable objects.
- Used to render latest room canvas quickly.

Canvas operations:

- Append-only action log.
- Used for undo, redo, audit, and incremental sync.

Snapshots:

- Periodically store compact canvas state.
- Default interval: every 500 operations.
- On room load, fetch latest snapshot plus later operations.

This avoids replaying all operations from room creation forever.

## 11. File Upload Strategy

Chat images should not be stored as database blobs.

Store:

- Files in Docker volume.
- Metadata in PostgreSQL.

Access rules:

- Only room members can access room chat images.
- Private chat images require sender or receiver identity.
- Validate file type and size.

## 12. Security Notes

Required:

- Password hashing with bcrypt or argon2.
- HttpOnly session cookies.
- Input validation on all REST and socket payloads.
- Permission checks on server side, not only frontend.
- Rate limits for login, register, chat, image upload, and canvas ops.
- File upload MIME and extension validation.
- No plaintext secrets in repository.

## 13. Migration Approach

The current project is a small Express app. Recommended migration path:

1. Create new app structure beside current implementation.
2. Build NestJS backend with auth and rooms.
3. Build React frontend shell.
4. Port current canvas engine into the React app.
5. Replace global drawing history with room-scoped persistence.
6. Add chat and permissions.
7. Move deployment to Docker Compose.

Do not attempt to patch all features into the current single `server.js` and single `app.js`. The project is now large enough to justify a structured rewrite.

