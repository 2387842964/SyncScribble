const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const express = require('express');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 8 * 1024 * 1024,
  cors: {
    origin: true,
    credentials: true
  }
});

const PORT = Number(process.env.PORT || 3000);
const NODE_ENV = process.env.NODE_ENV || 'development';
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS || 7 * 24 * 60 * 60 * 1000);
const INVITE_TTL_MS = Number(process.env.INVITE_TTL_MS || 2 * 60 * 1000);
const ROOM_IDLE_OWNER_ONLY_MS = Number(process.env.ROOM_IDLE_OWNER_ONLY_MS || 2 * 60 * 60 * 1000);
const ROOM_DESTROY_WARNING_MS = Number(process.env.ROOM_DESTROY_WARNING_MS || 60 * 1000);
const MAX_CHAT_IMAGE_DATA_URL_LENGTH = Number(process.env.MAX_CHAT_IMAGE_DATA_URL_LENGTH || 5 * 1024 * 1024);
const MAX_CANVAS_OBJECTS_PER_ROOM = Number(process.env.MAX_CANVAS_OBJECTS_PER_ROOM || 12000);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'state.json');
const COOKIE_SECURE = String(process.env.COOKIE_SECURE || 'false').toLowerCase() === 'true';

app.use(express.json({ limit: '8mb' }));

const store = {
  users: new Map(),
  sessions: new Map(),
  rooms: new Map()
};

const socketsByUser = new Map();
const roomTimers = new Map();

function now() {
  return Date.now();
}

function createId(bytes = 12) {
  return crypto.randomBytes(bytes).toString('hex');
}

function hashPassword(password) {
  const salt = createId(16);
  const hash = crypto.pbkdf2Sync(password, salt, 120000, 32, 'sha256').toString('hex');
  return `pbkdf2$${salt}$${hash}`;
}

function verifyPassword(password, passwordHash) {
  const [method, salt, expected] = String(passwordHash || '').split('$');
  if (method !== 'pbkdf2' || !salt || !expected) return false;
  const actual = crypto.pbkdf2Sync(password, salt, 120000, 32, 'sha256').toString('hex');
  return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}

function normalizeRoomId(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeUsername(value) {
  return String(value || '').trim();
}

function isValidUsername(value) {
  return /^[a-zA-Z0-9_\-\u4e00-\u9fa5]{2,24}$/.test(value);
}

function isValidPassword(value) {
  return typeof value === 'string' && value.length >= 6 && value.length <= 72;
}

function isValidRoomId(value) {
  return /^[a-z0-9][a-z0-9_-]{2,19}$/.test(value);
}

function isValidRoomName(value) {
  const name = String(value || '').trim();
  return name.length >= 2 && name.length <= 40;
}

function safeUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    createdAt: user.createdAt
  };
}

function defaultPermissions() {
  return {
    canChat: true,
    canSendImages: true,
    canDraw: true,
    canUseLaserPointer: true,
    canClearCanvas: true,
    canUndoRedo: true
  };
}

function serializeRoom(room, viewerId) {
  const members = Array.from(room.members.values()).map((member) => ({
    ...member,
    user: safeUser(store.users.get(member.userId)),
    online: isUserOnline(member.userId)
  }));

  return {
    id: room.id,
    roomName: room.roomName,
    visibility: room.visibility,
    maxMembers: room.maxMembers,
    ownerId: room.ownerId,
    createdAt: room.createdAt,
    destroyedAt: room.destroyedAt,
    onlineCount: members.filter((member) => member.online && !member.leftAt).length,
    memberCount: members.filter((member) => !member.leftAt).length,
    members,
    permissions: viewerId ? room.members.get(viewerId)?.permissions || defaultPermissions() : undefined
  };
}

function serializePublicRoom(room) {
  return {
    id: room.id,
    roomName: room.roomName,
    visibility: room.visibility,
    maxMembers: room.maxMembers,
    owner: safeUser(store.users.get(room.ownerId)),
    onlineCount: getOnlineMemberCount(room),
    memberCount: getActiveMembers(room).length,
    createdAt: room.createdAt
  };
}

function getActiveRooms() {
  return Array.from(store.rooms.values()).filter((room) => !room.destroyedAt);
}

function getPublicRooms() {
  return getActiveRooms()
    .filter((room) => room.visibility === 'public')
    .map(serializePublicRoom)
    .sort((a, b) => b.createdAt - a.createdAt);
}

function getActiveMembers(room) {
  return Array.from(room.members.values()).filter((member) => !member.leftAt);
}

function getOnlineMemberCount(room) {
  return getActiveMembers(room).filter((member) => isUserOnline(member.userId)).length;
}

function isUserOnline(userId) {
  return socketsByUser.has(userId) && socketsByUser.get(userId).size > 0;
}

function getUserActiveRoom(userId) {
  return getActiveRooms().find((room) => {
    const member = room.members.get(userId);
    return member && !member.leftAt;
  });
}

function createSession(userId) {
  const token = createId(24);
  store.sessions.set(token, {
    token,
    userId,
    expiresAt: now() + SESSION_TTL_MS
  });
  persistSoon();
  return token;
}

function parseCookies(header) {
  const cookies = {};
  if (!header) return cookies;
  for (const pair of header.split(';')) {
    const index = pair.indexOf('=');
    if (index === -1) continue;
    const key = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

function getSessionFromRequest(req) {
  const token = parseCookies(req.headers.cookie).syncscribble_session;
  if (!token) return null;
  const session = store.sessions.get(token);
  if (!session || session.expiresAt <= now()) {
    store.sessions.delete(token);
    return null;
  }
  return session;
}

function auth(req, res, next) {
  const session = getSessionFromRequest(req);
  if (!session) {
    res.status(401).json({ error: 'AUTH_REQUIRED', message: '请先登录' });
    return;
  }
  const user = store.users.get(session.userId);
  if (!user) {
    res.status(401).json({ error: 'AUTH_REQUIRED', message: '用户不存在' });
    return;
  }
  req.session = session;
  req.user = user;
  next();
}

function setSessionCookie(res, token) {
  const secure = COOKIE_SECURE ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `syncscribble_session=${encodeURIComponent(token)}; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}; Path=/; HttpOnly; SameSite=Lax${secure}`
  );
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'syncscribble_session=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax');
}

function ensureRoom(roomId) {
  const room = store.rooms.get(normalizeRoomId(roomId));
  if (!room || room.destroyedAt) return null;
  return room;
}

function ensureMember(room, userId) {
  const member = room.members.get(userId);
  if (!member || member.leftAt) return null;
  return member;
}

function requireRoomMember(req, res, next) {
  const room = ensureRoom(req.params.roomId);
  if (!room) {
    res.status(404).json({ error: 'ROOM_NOT_FOUND', message: '房间不存在或已销毁' });
    return;
  }
  const member = ensureMember(room, req.user.id);
  if (!member) {
    res.status(403).json({ error: 'NOT_ROOM_MEMBER', message: '你不在该房间中' });
    return;
  }
  req.room = room;
  req.member = member;
  next();
}

function requireOwner(req, res, next) {
  if (req.room.ownerId !== req.user.id) {
    res.status(403).json({ error: 'OWNER_REQUIRED', message: '只有房主可以执行此操作' });
    return;
  }
  next();
}

function addSocketForUser(userId, socketId) {
  if (!socketsByUser.has(userId)) socketsByUser.set(userId, new Set());
  socketsByUser.get(userId).add(socketId);
}

function removeSocketForUser(userId, socketId) {
  const set = socketsByUser.get(userId);
  if (!set) return;
  set.delete(socketId);
  if (set.size === 0) socketsByUser.delete(userId);
}

function emitLobby() {
  io.emit('lobby:rooms', getPublicRooms());
}

function emitRoomState(room) {
  io.to(room.id).emit('room:state', serializeRoom(room));
  emitLobby();
}

function createRoomMember(userId, role) {
  return {
    userId,
    role,
    joinedAt: now(),
    leftAt: null,
    permissions: defaultPermissions(),
    mutedUntil: null,
    bannedUntil: null
  };
}

function checkBan(room, userId) {
  const ban = room.bans.get(userId);
  if (!ban) return null;
  if (ban.expiresAt && ban.expiresAt <= now()) {
    room.bans.delete(userId);
    return null;
  }
  return ban;
}

function joinRoom(room, user) {
  const existingActiveRoom = getUserActiveRoom(user.id);
  if (existingActiveRoom && existingActiveRoom.id !== room.id) {
    throw Object.assign(new Error('用户只能同时在一个房间中'), { code: 'USER_ALREADY_IN_ROOM', status: 409 });
  }

  const ban = checkBan(room, user.id);
  if (ban) {
    throw Object.assign(new Error('你暂时不能回到这个房间'), { code: 'USER_BANNED', status: 403, details: { expiresAt: ban.expiresAt } });
  }

  let member = room.members.get(user.id);
  if (member && !member.leftAt) return member;

  if (getActiveMembers(room).length >= room.maxMembers) {
    throw Object.assign(new Error('房间人数已满'), { code: 'ROOM_FULL', status: 409 });
  }

  if (member && member.leftAt) {
    member.leftAt = null;
    member.joinedAt = now();
  } else {
    member = createRoomMember(user.id, 'member');
    room.members.set(user.id, member);
  }
  if (user.id !== room.ownerId) {
    room.ownerOnlySince = null;
  }
  room.lastActivityAt = now();
  scheduleRoomLifecycle(room);
  persistSoon();
  return member;
}

function leaveRoom(room, userId) {
  const member = room.members.get(userId);
  if (!member || member.leftAt) return;
  member.leftAt = now();

  if (room.ownerId === userId) {
    const nextOwner = getActiveMembers(room).sort((a, b) => a.joinedAt - b.joinedAt)[0];
    if (nextOwner) {
      room.ownerId = nextOwner.userId;
      nextOwner.role = 'owner';
      member.role = 'member';
      io.to(room.id).emit('presence:owner-changed', {
        roomId: room.id,
        previousOwnerId: userId,
        newOwnerId: nextOwner.userId
      });
    }
  }

  scheduleRoomLifecycle(room);
  emitRoomState(room);
  persistSoon();
}

function scheduleRoomLifecycle(room) {
  const existing = roomTimers.get(room.id);
  if (existing) clearTimeout(existing);

  if (room.destroyedAt) return;

  const active = getActiveMembers(room);
  if (active.length === 0) {
    destroyRoom(room, 'empty');
    return;
  }

  const nonOwnerActive = active.filter((member) => member.userId !== room.ownerId);
  if (nonOwnerActive.length > 0) {
    room.ownerOnlySince = null;
    return;
  }

  const deadline = (room.ownerOnlySince || now()) + ROOM_IDLE_OWNER_ONLY_MS;
  room.ownerOnlySince = room.ownerOnlySince || now();
  const warningAt = deadline - ROOM_DESTROY_WARNING_MS;
  const delay = Math.max(1000, Math.min(warningAt - now(), deadline - now()));

  const timer = setTimeout(() => {
    if (room.destroyedAt) return;
    const currentActive = getActiveMembers(room);
    const currentNonOwnerActive = currentActive.filter((member) => member.userId !== room.ownerId);
    if (currentNonOwnerActive.length > 0) {
      room.ownerOnlySince = null;
      scheduleRoomLifecycle(room);
      return;
    }
    if (deadline - now() <= ROOM_DESTROY_WARNING_MS && deadline > now()) {
      io.to(room.id).emit('room:destroy-warning', {
        roomId: room.id,
        destroyAt: deadline,
        secondsRemaining: Math.ceil((deadline - now()) / 1000)
      });
      roomTimers.set(room.id, setTimeout(() => destroyRoom(room, 'owner_only_timeout'), Math.max(1000, deadline - now())));
      return;
    }
    destroyRoom(room, 'owner_only_timeout');
  }, delay);

  roomTimers.set(room.id, timer);
}

function destroyRoom(room, reason) {
  if (room.destroyedAt) return;
  room.destroyedAt = now();
  room.destroyReason = reason;
  room.chatMessages = [];
  room.canvasObjects = [];
  room.operations = [];
  room.invites.clear();
  io.to(room.id).emit('room:destroyed', { roomId: room.id, reason });
  io.in(room.id).socketsLeave(room.id);
  const timer = roomTimers.get(room.id);
  if (timer) clearTimeout(timer);
  roomTimers.delete(room.id);
  emitLobby();
  persistSoon();
}

function parseDurationMs(value, fallback = 10 * 60 * 1000) {
  const duration = Number(value);
  if (!Number.isFinite(duration) || duration <= 0) return fallback;
  return Math.min(duration, 365 * 24 * 60 * 60 * 1000);
}

function makeChatMessage(room, senderId, payload) {
  const scope = payload.scope === 'private' ? 'private' : 'group';
  const messageType = payload.messageType === 'image' ? 'image' : 'text';
  const text = String(payload.text || '').trim();
  const imageDataUrl = typeof payload.imageDataUrl === 'string' ? payload.imageDataUrl : '';

  if (scope === 'private') {
    if (!payload.receiverId || !ensureMember(room, payload.receiverId)) {
      throw Object.assign(new Error('私聊对象必须在同一个房间内'), { code: 'INVALID_RECEIVER' });
    }
    if (payload.receiverId === senderId) {
      throw Object.assign(new Error('不能给自己发送私聊'), { code: 'INVALID_RECEIVER' });
    }
  }

  if (messageType === 'text' && (text.length === 0 || text.length > 1000)) {
    throw Object.assign(new Error('消息长度不合法'), { code: 'INVALID_MESSAGE' });
  }
  if (messageType === 'image' && (!imageDataUrl.startsWith('data:image/') || imageDataUrl.length > MAX_CHAT_IMAGE_DATA_URL_LENGTH)) {
    throw Object.assign(new Error('图片格式或大小不合法'), { code: 'INVALID_IMAGE' });
  }

  return {
    id: createId(12),
    roomId: room.id,
    senderId,
    scope,
    receiverId: scope === 'private' ? payload.receiverId : null,
    messageType,
    text: messageType === 'text' ? text : '',
    imageDataUrl: messageType === 'image' ? imageDataUrl : '',
    createdAt: now()
  };
}

function applyCanvasOperation(room, userId, payload) {
  const operationType = payload.operationType;
  const objectId = String(payload.objectId || createId(10));
  const objectPayload = payload.payload && typeof payload.payload === 'object' ? payload.payload : {};
  const existing = room.canvasObjects.find((object) => object.id === objectId);

  if (['update', 'delete', 'undo', 'redo'].includes(operationType) && existing && existing.userId !== userId) {
    throw Object.assign(new Error('只能操作自己的画布对象'), { code: 'OBJECT_NOT_OWNED' });
  }

  if (operationType === 'create') {
    if (room.canvasObjects.length >= MAX_CANVAS_OBJECTS_PER_ROOM) {
      throw Object.assign(new Error('画布对象数量已达到上限'), { code: 'CANVAS_LIMIT' });
    }
    const object = {
      id: objectId,
      roomId: room.id,
      userId,
      type: objectPayload.type || 'stroke',
      payload: objectPayload,
      visible: true,
      createdAt: now(),
      updatedAt: now()
    };
    room.canvasObjects.push(object);
  } else if (operationType === 'update') {
    if (!existing) throw Object.assign(new Error('画布对象不存在'), { code: 'OBJECT_NOT_FOUND' });
    existing.payload = { ...existing.payload, ...objectPayload };
    existing.updatedAt = now();
  } else if (operationType === 'delete' || operationType === 'undo') {
    if (!existing) throw Object.assign(new Error('画布对象不存在'), { code: 'OBJECT_NOT_FOUND' });
    existing.visible = false;
    existing.updatedAt = now();
  } else if (operationType === 'redo') {
    if (!existing) throw Object.assign(new Error('画布对象不存在'), { code: 'OBJECT_NOT_FOUND' });
    existing.visible = true;
    existing.updatedAt = now();
  } else if (operationType === 'clear') {
    for (const object of room.canvasObjects) {
      object.visible = false;
      object.updatedAt = now();
    }
  } else {
    throw Object.assign(new Error('不支持的画布操作'), { code: 'INVALID_OPERATION' });
  }

  const operation = {
    id: createId(12),
    clientOperationId: payload.clientOperationId || null,
    roomId: room.id,
    userId,
    operationType,
    objectId,
    payload: objectPayload,
    createdAt: now()
  };
  room.operations.push(operation);
  room.lastActivityAt = now();
  persistSoon();
  return operation;
}

let persistTimer = null;

function persistSoon() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    persistNow();
  }, 300);
}

function persistNow() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const payload = {
    users: Array.from(store.users.values()),
    sessions: Array.from(store.sessions.values()),
    rooms: Array.from(store.rooms.values()).map((room) => ({
      ...room,
      members: Array.from(room.members.entries()),
      bans: Array.from(room.bans.entries()),
      invites: Array.from(room.invites.entries())
    }))
  };
  fs.writeFileSync(DATA_FILE, JSON.stringify(payload, null, 2));
}

function loadState() {
  if (!fs.existsSync(DATA_FILE)) return;
  const payload = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  for (const user of payload.users || []) store.users.set(user.id, user);
  for (const session of payload.sessions || []) {
    if (session.expiresAt > now()) store.sessions.set(session.token, session);
  }
  for (const raw of payload.rooms || []) {
    const room = {
      ...raw,
      members: new Map(raw.members || []),
      bans: new Map(raw.bans || []),
      invites: new Map(raw.invites || [])
    };
    if (!room.destroyedAt) {
      store.rooms.set(room.id, room);
      scheduleRoomLifecycle(room);
    }
  }
}

function apiError(res, error) {
  res.status(error.status || 400).json({
    error: error.code || 'BAD_REQUEST',
    message: error.message || '请求不合法',
    details: error.details
  });
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

app.post('/api/auth/register', (req, res) => {
  try {
    const username = normalizeUsername(req.body.username);
    const password = req.body.password;
    if (!isValidUsername(username)) throw Object.assign(new Error('用户名需为 2-24 位中文、字母、数字、下划线或短横线'), { code: 'INVALID_USERNAME' });
    if (!isValidPassword(password)) throw Object.assign(new Error('密码需为 6-72 位'), { code: 'INVALID_PASSWORD' });
    const taken = Array.from(store.users.values()).some((user) => user.username.toLowerCase() === username.toLowerCase());
    if (taken) throw Object.assign(new Error('用户名已存在'), { code: 'USERNAME_TAKEN', status: 409 });
    const user = {
      id: createId(10),
      username,
      passwordHash: hashPassword(password),
      authProviders: { phone: null, email: null },
      createdAt: now()
    };
    store.users.set(user.id, user);
    const token = createSession(user.id);
    setSessionCookie(res, token);
    persistSoon();
    res.status(201).json({ user: safeUser(user) });
  } catch (error) {
    apiError(res, error);
  }
});

app.post('/api/auth/login', (req, res) => {
  try {
    const username = normalizeUsername(req.body.username);
    const user = Array.from(store.users.values()).find((item) => item.username.toLowerCase() === username.toLowerCase());
    if (!user || !verifyPassword(req.body.password || '', user.passwordHash)) {
      throw Object.assign(new Error('用户名或密码错误'), { code: 'INVALID_CREDENTIALS', status: 401 });
    }
    const token = createSession(user.id);
    setSessionCookie(res, token);
    res.json({ user: safeUser(user) });
  } catch (error) {
    apiError(res, error);
  }
});

app.post('/api/auth/logout', auth, (req, res) => {
  store.sessions.delete(req.session.token);
  clearSessionCookie(res);
  persistSoon();
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
  const session = getSessionFromRequest(req);
  const user = session ? store.users.get(session.userId) : null;
  res.json({ user: safeUser(user) });
});

app.get('/api/rooms/public', auth, (req, res) => {
  res.json({ rooms: getPublicRooms(), activeRoom: getUserActiveRoom(req.user.id)?.id || null });
});

app.post('/api/rooms', auth, (req, res) => {
  try {
    if (getUserActiveRoom(req.user.id)) {
      throw Object.assign(new Error('你已经在一个房间中，需先退出当前房间'), { code: 'USER_ALREADY_IN_ROOM', status: 409 });
    }
    const roomId = normalizeRoomId(req.body.roomId);
    const roomName = String(req.body.roomName || '').trim();
    const visibility = req.body.visibility === 'private' ? 'private' : 'public';
    const allowedMax = [2, 5, 10, 20];
    const maxMembers = allowedMax.includes(Number(req.body.maxMembers)) ? Number(req.body.maxMembers) : 5;
    if (!isValidRoomId(roomId)) throw Object.assign(new Error('房间号需为 3-20 位小写字母、数字、下划线或短横线'), { code: 'INVALID_ROOM_ID' });
    if (!isValidRoomName(roomName)) throw Object.assign(new Error('房间名称需为 2-40 位'), { code: 'INVALID_ROOM_NAME' });
    if (ensureRoom(roomId)) throw Object.assign(new Error('房间号已被占用'), { code: 'ROOM_ID_TAKEN', status: 409 });

    const member = createRoomMember(req.user.id, 'owner');
    const room = {
      id: roomId,
      roomName,
      visibility,
      maxMembers,
      ownerId: req.user.id,
      members: new Map([[req.user.id, member]]),
      bans: new Map(),
      invites: new Map(),
      chatMessages: [],
      canvasObjects: [],
      operations: [],
      createdAt: now(),
      lastActivityAt: now(),
      ownerOnlySince: now(),
      destroyedAt: null,
      destroyReason: null
    };
    store.rooms.set(room.id, room);
    scheduleRoomLifecycle(room);
    emitLobby();
    persistSoon();
    res.status(201).json({ room: serializeRoom(room, req.user.id) });
  } catch (error) {
    apiError(res, error);
  }
});

app.post('/api/rooms/:roomId/join', auth, (req, res) => {
  try {
    const room = ensureRoom(req.params.roomId);
    if (!room) throw Object.assign(new Error('房间不存在或已销毁'), { code: 'ROOM_NOT_FOUND', status: 404 });

    if (room.visibility === 'private') {
      const token = String(req.body.inviteToken || req.query.inviteToken || '');
      const invite = room.invites.get(token);
      if (!invite || invite.expiresAt <= now()) {
        throw Object.assign(new Error('邀请码无效或已过期'), { code: 'INVALID_INVITE', status: 403 });
      }
    }

    joinRoom(room, req.user);
    emitRoomState(room);
    res.json({
      room: serializeRoom(room, req.user.id),
      canvasObjects: room.canvasObjects.filter((object) => object.visible),
      chatMessages: room.chatMessages.filter((message) => message.scope === 'group' || message.senderId === req.user.id || message.receiverId === req.user.id)
    });
  } catch (error) {
    apiError(res, error);
  }
});

app.post('/api/rooms/:roomId/leave', auth, requireRoomMember, (req, res) => {
  leaveRoom(req.room, req.user.id);
  res.json({ ok: true });
});

app.get('/api/rooms/:roomId', auth, requireRoomMember, (req, res) => {
  res.json({
    room: serializeRoom(req.room, req.user.id),
    canvasObjects: req.room.canvasObjects.filter((object) => object.visible),
    chatMessages: req.room.chatMessages.filter((message) => message.scope === 'group' || message.senderId === req.user.id || message.receiverId === req.user.id)
  });
});

app.post('/api/rooms/:roomId/invites', auth, requireRoomMember, requireOwner, (req, res) => {
  const token = createId(8);
  const expiresAt = now() + INVITE_TTL_MS;
  req.room.invites.set(token, { token, createdBy: req.user.id, expiresAt });
  persistSoon();
  res.json({
    inviteToken: token,
    expiresAt,
    link: `/join/${req.room.id}/${token}`
  });
});

app.patch('/api/rooms/:roomId/members/:userId/permissions', auth, requireRoomMember, requireOwner, (req, res) => {
  try {
    const target = ensureMember(req.room, req.params.userId);
    if (!target) throw Object.assign(new Error('成员不存在'), { code: 'MEMBER_NOT_FOUND', status: 404 });
    if (target.userId === req.room.ownerId) throw Object.assign(new Error('不能修改房主权限'), { code: 'INVALID_TARGET' });
    const allowed = Object.keys(defaultPermissions());
    for (const key of allowed) {
      if (typeof req.body[key] === 'boolean') target.permissions[key] = req.body[key];
    }
    emitRoomState(req.room);
    io.to(req.room.id).emit('permissions:updated', {
      roomId: req.room.id,
      targetUserId: target.userId,
      permissions: target.permissions
    });
    persistSoon();
    res.json({ member: target });
  } catch (error) {
    apiError(res, error);
  }
});

app.post('/api/rooms/:roomId/members/:userId/kick', auth, requireRoomMember, requireOwner, (req, res) => {
  try {
    const target = ensureMember(req.room, req.params.userId);
    if (!target) throw Object.assign(new Error('成员不存在'), { code: 'MEMBER_NOT_FOUND', status: 404 });
    if (target.userId === req.room.ownerId) throw Object.assign(new Error('不能踢出房主'), { code: 'INVALID_TARGET' });
    const banDurationMs = parseDurationMs(req.body.banDurationMs, 10 * 60 * 1000);
    req.room.bans.set(target.userId, {
      userId: target.userId,
      createdBy: req.user.id,
      reason: String(req.body.reason || '').slice(0, 200),
      expiresAt: now() + banDurationMs
    });
    target.leftAt = now();
    io.to(req.room.id).emit('member:kicked', { roomId: req.room.id, targetUserId: target.userId });
    emitRoomState(req.room);
    scheduleRoomLifecycle(req.room);
    persistSoon();
    res.json({ ok: true });
  } catch (error) {
    apiError(res, error);
  }
});

app.post('/api/rooms/:roomId/destroy', auth, requireRoomMember, requireOwner, (req, res) => {
  destroyRoom(req.room, 'owner_destroyed');
  res.json({ ok: true });
});

io.use((socket, next) => {
  const token = parseCookies(socket.handshake.headers.cookie).syncscribble_session;
  const session = token ? store.sessions.get(token) : null;
  if (!session || session.expiresAt <= now()) {
    next(new Error('AUTH_REQUIRED'));
    return;
  }
  const user = store.users.get(session.userId);
  if (!user) {
    next(new Error('AUTH_REQUIRED'));
    return;
  }
  socket.data.user = user;
  next();
});

io.on('connection', (socket) => {
  const user = socket.data.user;
  addSocketForUser(user.id, socket.id);
  socket.emit('lobby:rooms', getPublicRooms());

  socket.on('room:join', ({ roomId }, callback) => {
    const room = ensureRoom(roomId);
    const member = room ? ensureMember(room, user.id) : null;
    if (!room || !member) {
      callback?.({ error: 'NOT_ROOM_MEMBER' });
      return;
    }
    socket.join(room.id);
    emitRoomState(room);
    callback?.({ ok: true, room: serializeRoom(room, user.id) });
  });

  socket.on('chat:send', (payload, callback) => {
    try {
      const room = ensureRoom(payload.roomId);
      const member = room ? ensureMember(room, user.id) : null;
      if (!room || !member) throw Object.assign(new Error('你不在该房间中'), { code: 'NOT_ROOM_MEMBER' });
      if (!member.permissions.canChat) throw Object.assign(new Error('你已被禁言'), { code: 'PERMISSION_DENIED' });
      if (payload.messageType === 'image' && !member.permissions.canSendImages) throw Object.assign(new Error('你不能发送图片'), { code: 'PERMISSION_DENIED' });
      const message = makeChatMessage(room, user.id, payload);
      room.chatMessages.push(message);
      room.lastActivityAt = now();
      persistSoon();
      if (message.scope === 'private') {
        for (const socketId of socketsByUser.get(message.senderId) || []) io.to(socketId).emit('chat:message', message);
        for (const socketId of socketsByUser.get(message.receiverId) || []) io.to(socketId).emit('chat:message', message);
      } else {
        io.to(room.id).emit('chat:message', message);
      }
      callback?.({ ok: true, message });
    } catch (error) {
      callback?.({ error: error.code || 'BAD_REQUEST', message: error.message });
    }
  });

  socket.on('canvas:operation', (payload, callback) => {
    try {
      const room = ensureRoom(payload.roomId);
      const member = room ? ensureMember(room, user.id) : null;
      if (!room || !member) throw Object.assign(new Error('你不在该房间中'), { code: 'NOT_ROOM_MEMBER' });
      if (payload.operationType === 'clear') {
        if (!member.permissions.canClearCanvas) throw Object.assign(new Error('你不能清空画布'), { code: 'PERMISSION_DENIED' });
      } else if (['undo', 'redo'].includes(payload.operationType)) {
        if (!member.permissions.canUndoRedo) throw Object.assign(new Error('你不能撤销或重做'), { code: 'PERMISSION_DENIED' });
      } else if (!member.permissions.canDraw) {
        throw Object.assign(new Error('你不能操作画布'), { code: 'PERMISSION_DENIED' });
      }
      const operation = applyCanvasOperation(room, user.id, payload);
      io.to(room.id).emit('canvas:operation-applied', operation);
      callback?.({ ok: true, operation });
    } catch (error) {
      callback?.({ error: error.code || 'BAD_REQUEST', message: error.message });
    }
  });

  socket.on('canvas:undo', ({ roomId }, callback) => {
    const room = ensureRoom(roomId);
    const member = room ? ensureMember(room, user.id) : null;
    if (!room || !member || !member.permissions.canUndoRedo) {
      callback?.({ error: 'PERMISSION_DENIED' });
      return;
    }
    const object = [...room.canvasObjects].reverse().find((item) => item.userId === user.id && item.visible);
    if (!object) {
      callback?.({ ok: false });
      return;
    }
    const operation = applyCanvasOperation(room, user.id, { roomId, operationType: 'undo', objectId: object.id, payload: {} });
    io.to(room.id).emit('canvas:operation-applied', operation);
    callback?.({ ok: true, operation });
  });

  socket.on('canvas:redo', ({ roomId }, callback) => {
    const room = ensureRoom(roomId);
    const member = room ? ensureMember(room, user.id) : null;
    if (!room || !member || !member.permissions.canUndoRedo) {
      callback?.({ error: 'PERMISSION_DENIED' });
      return;
    }
    const object = [...room.canvasObjects].reverse().find((item) => item.userId === user.id && !item.visible);
    if (!object) {
      callback?.({ ok: false });
      return;
    }
    const operation = applyCanvasOperation(room, user.id, { roomId, operationType: 'redo', objectId: object.id, payload: {} });
    io.to(room.id).emit('canvas:operation-applied', operation);
    callback?.({ ok: true, operation });
  });

  socket.on('laser:move', (payload) => {
    const room = ensureRoom(payload.roomId);
    const member = room ? ensureMember(room, user.id) : null;
    if (!room || !member || !member.permissions.canUseLaserPointer) return;
    socket.to(room.id).emit('laser:move', {
      roomId: room.id,
      userId: user.id,
      x: Number(payload.x),
      y: Number(payload.y),
      color: payload.color || '#e94560',
      expiresAt: now() + 1200
    });
  });

  socket.on('disconnect', () => {
    removeSocketForUser(user.id, socket.id);
    for (const room of getActiveRooms()) {
      if (room.members.has(user.id)) emitRoomState(room);
    }
    emitLobby();
  });
});

const distDir = path.join(__dirname, 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) return res.status(404).end();
    res.sendFile(path.join(distDir, 'index.html'));
  });
} else {
  app.use(express.static('public'));
}

loadState();

server.listen(PORT, () => {
  console.log(`SyncScribble server running at http://localhost:${PORT}`);
});
