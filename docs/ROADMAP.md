# SyncScribble Upgrade Roadmap

## Phase 0: Preparation

Goal:

- Preserve current working app while preparing the rewrite.

Tasks:

- Confirm PostgreSQL and Redis connection details.
- Inspect Docker networks without changing existing Sub2API services.
- Decide whether to reuse existing PostgreSQL/Redis or create dedicated containers.
- Add environment variable plan.
- Create initial Docker Compose plan.
- Keep current deployed app running until replacement is ready.

Deliverables:

- Environment inventory.
- Database access plan.
- Deployment plan.

## Phase 1: Project Restructure

Goal:

- Move from single-file Express and vanilla JS to structured frontend/backend.

Tasks:

- Create monorepo or two-app structure.
- Add NestJS backend.
- Add React + Vite frontend.
- Add shared TypeScript types if useful.
- Add Dockerfiles.
- Add compose file.
- Add health checks.

Deliverables:

- Backend starts.
- Frontend starts.
- Nginx routes basic pages and API.

## Phase 2: Auth

Goal:

- Add user identity.

Tasks:

- User registration.
- User login.
- 7-day Redis session.
- Logout.
- Authenticated Socket.IO handshake.
- Password hashing.

Deliverables:

- Register/login/logout flow.
- Current user endpoint.
- Protected app routes.

## Phase 3: Rooms and Lobby

Goal:

- Add room-based collaboration shell.

Tasks:

- Create room.
- Validate unique active `roomId`.
- Add `roomName`.
- Add public/private visibility.
- Add max member selection: 2, 5, 10, 20.
- Add public lobby realtime list.
- Add join by room ID.
- Add join by invite link.
- Add invite token TTL.
- Add one-active-room-per-user rule.

Deliverables:

- Lobby page.
- Room creation page.
- Room shell page.
- Real-time online count.

## Phase 4: Room Lifecycle and Ownership

Goal:

- Implement robust room lifecycle.

Tasks:

- Owner assignment.
- Owner transfer by online join order.
- Room leave.
- Disconnect/reconnect handling.
- No-guest cleanup timer.
- Destroy warning timer.
- Room destruction.
- Release `roomId`.

Deliverables:

- Correct owner transfer.
- Auto room cleanup.
- Room destroy notifications.

## Phase 5: Chat

Goal:

- Add group and private chat.

Tasks:

- Group text chat.
- Private text chat.
- Chat persistence while room exists.
- Message cleanup on room destroy.
- Image upload.
- Group image messages.
- Private image messages.
- Image authorization.

Deliverables:

- Room chat panel.
- Private chat UI.
- Image messages.

## Phase 6: Permissions and Moderation

Goal:

- Add owner controls.

Tasks:

- Permission flags.
- Disable chat.
- Disable image sending.
- Disable drawing.
- Disable laser pointer.
- Disable clear canvas.
- Kick user.
- Ban user with presets.
- Ban user with custom duration.

Deliverables:

- Owner management UI.
- Permission enforcement on server.
- Member status indicators.

## Phase 7: Canvas Migration

Goal:

- Convert current canvas from raw event replay to room-scoped object operations.

Tasks:

- Port current canvas rendering into React app.
- Define canvas object schema.
- Implement stroke object.
- Implement eraser object.
- Implement room-scoped canvas sync.
- Persist canvas objects.
- Persist canvas operations.
- Add snapshots.
- Load snapshot plus incremental operations.

Deliverables:

- Current drawing features preserved.
- Room-specific persistent canvas.

## Phase 8: Canvas Enhancements

Goal:

- Add first wave whiteboard features.

Tasks:

- Undo own operations.
- Redo own operations.
- Shape tools: line, rectangle, ellipse, arrow.
- Text tool.
- Select own objects.
- Move own objects.
- Delete own objects.
- Laser pointer.
- Online drawing status.
- Export PNG.

Deliverables:

- Functional object-based whiteboard.
- Collaboration-focused tools.

## Phase 9: Docker Compose Deployment

Goal:

- Replace manual systemd deployment with compose-based deployment.

Tasks:

- Build frontend image.
- Build backend image.
- Configure Nginx.
- Attach to existing PostgreSQL/Redis network or dedicated containers.
- Add upload volume.
- Add logs.
- Add restart policy.
- Add migration command.
- Add backup notes.

Deliverables:

- `docker compose up -d` deployment.
- Nginx WebSocket proxy.
- Persistent upload volume.

## Phase 10: Hardening

Goal:

- Make the app safer and more stable.

Tasks:

- Rate limits.
- File upload security.
- CSRF protection.
- Input validation.
- Socket event validation.
- Audit logging for moderation.
- Database indexes.
- Basic monitoring.
- Backup strategy.

Deliverables:

- Production-ready first release.

## Later Features

- Strict invite-only rooms.
- Infinite canvas.
- Layers.
- Object locking.
- Grid and snapping.
- Sticky notes.
- Paste image onto canvas.
- Export SVG.
- Export PDF.
- Room templates.
- Version history restore.
- Multi-server Socket.IO with Redis adapter.

