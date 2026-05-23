# SyncScribble Deployment Plan

## Current Target

Deploy with Docker Compose on `49.233.119.4`.

The current implementation can run without PostgreSQL and Redis by persisting state to a Docker volume. PostgreSQL and Redis are still reserved in configuration for the next persistence step.

## Services

- `syncscribble-app`: Node.js API, Socket.IO, and built React frontend.
- `syncscribble_data`: Docker volume for current JSON persistence.
- Host port `3001` maps to container port `3000`.
- Nginx proxies public port `80` to `127.0.0.1:3001`.

## Environment

Recommended `.env`:

```bash
NODE_ENV=production
PORT=3000
SESSION_TTL_MS=604800000
INVITE_TTL_MS=120000
ROOM_IDLE_OWNER_ONLY_MS=7200000
ROOM_DESTROY_WARNING_MS=60000
DATA_DIR=/app/data
DATABASE_URL=
REDIS_URL=
REDIS_KEY_PREFIX=syncscribble:
```

Important configurable values:

- `SESSION_TTL_MS`: login session TTL. Default is 7 days.
- `INVITE_TTL_MS`: invite link TTL. Default is 2 minutes.
- `ROOM_IDLE_OWNER_ONLY_MS`: room destroy time when only owner remains. Default is 2 hours.
- `ROOM_DESTROY_WARNING_MS`: warning countdown before auto destroy. Default is 60 seconds.

## PostgreSQL and Redis Isolation

The server already has PostgreSQL and Redis used by Sub2API. Do not change their passwords and do not reuse Sub2API's database.

When enabling durable database persistence:

1. Create a new PostgreSQL database named `syncscribble`.
2. Create a new PostgreSQL user named `syncscribble_user`.
3. Grant privileges only on the `syncscribble` database.
4. Use Redis keys with `syncscribble:` prefix.
5. Never run `FLUSHDB` or `FLUSHALL` on shared Redis.

Example database initialization:

```sql
CREATE USER syncscribble_user WITH PASSWORD 'replace-with-strong-password';
CREATE DATABASE syncscribble OWNER syncscribble_user;
GRANT ALL PRIVILEGES ON DATABASE syncscribble TO syncscribble_user;
```

## Deployment Commands

On the server:

```bash
cd /opt
git clone https://github.com/2387842964/SyncScribble.git syncscribble
cd /opt/syncscribble
docker compose up -d --build
```

Configure Nginx:

```bash
cp deploy/nginx.conf /etc/nginx/conf.d/syncscribble.conf
nginx -t
systemctl reload nginx
```

Health checks:

```bash
docker compose ps
curl http://127.0.0.1:3001/api/health
curl http://127.0.0.1/
```

## Upgrade Flow

```bash
cd /opt/syncscribble
git pull
docker compose up -d --build
docker compose logs -f --tail=100 syncscribble
```

## Rollback Flow

```bash
cd /opt/syncscribble
git log --oneline -5
git checkout <previous-commit>
docker compose up -d --build
```

## Current Persistence Limitation

This MVP stores users, sessions, rooms, chat, and canvas state in `/app/data/state.json`.

This is acceptable for a first deploy and single-instance testing, but the next production step should move persistence to PostgreSQL and session/invite/presence TTL data to Redis.
