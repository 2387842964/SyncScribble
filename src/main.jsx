import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { io } from 'socket.io-client';
import { api, formatTime, roomLink } from './lib/api';
import { createStrokeObject, drawObjects, getCanvasPoint } from './lib/canvasEngine';
import './styles.css';

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [route, setRoute] = useState(parseRoute());

  useEffect(() => {
    api('/api/auth/me')
      .then((data) => setUser(data.user))
      .finally(() => setLoading(false));

    const onPop = () => setRoute(parseRoute());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  function navigate(path) {
    window.history.pushState({}, '', path);
    setRoute(parseRoute());
  }

  if (loading) return <Shell><div className="loading">加载中...</div></Shell>;
  if (!user) return <AuthPage onAuthed={setUser} />;

  if (route.name === 'join') {
    return <JoinPage user={user} route={route} navigate={navigate} />;
  }

  if (route.name === 'room') {
    return <RoomPage user={user} roomId={route.roomId} navigate={navigate} />;
  }

  return <LobbyPage user={user} setUser={setUser} navigate={navigate} />;
}

function parseRoute() {
  const parts = window.location.pathname.split('/').filter(Boolean);
  if (parts[0] === 'rooms' && parts[1]) return { name: 'room', roomId: parts[1] };
  if (parts[0] === 'join' && parts[1]) return { name: 'join', roomId: parts[1], inviteToken: parts[2] || '' };
  return { name: 'lobby' };
}

function Shell({ children }) {
  return <div className="app-shell">{children}</div>;
}

function AuthPage({ onAuthed }) {
  const [mode, setMode] = useState('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault();
    setError('');
    try {
      const data = await api(`/api/auth/${mode}`, { method: 'POST', body: { username, password } });
      onAuthed(data.user);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <Shell>
      <main className="auth-stage">
        <section className="hero-card">
          <p className="eyebrow">Realtime Whiteboard</p>
          <h1>SyncScribble</h1>
          <p>面向小组协作的实时白板，支持房间、聊天、权限管理和持续保存的画布。</p>
        </section>
        <form className="auth-card" onSubmit={submit}>
          <h2>{mode === 'login' ? '登录' : '注册'}</h2>
          <label>用户名</label>
          <input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="2-24 位用户名" />
          <label>密码</label>
          <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" placeholder="至少 6 位" />
          {error && <p className="form-error">{error}</p>}
          <button className="primary-btn" type="submit">{mode === 'login' ? '登录' : '创建账号'}</button>
          <button className="link-btn" type="button" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
            {mode === 'login' ? '没有账号，去注册' : '已有账号，去登录'}
          </button>
        </form>
      </main>
    </Shell>
  );
}

function LobbyPage({ user, setUser, navigate }) {
  const [rooms, setRooms] = useState([]);
  const [activeRoom, setActiveRoom] = useState(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ roomId: '', roomName: '', visibility: 'public', maxMembers: 5 });
  const socketRef = useRef(null);

  useEffect(() => {
    refreshRooms();
    const socket = io({ withCredentials: true });
    socketRef.current = socket;
    socket.on('lobby:rooms', setRooms);
    return () => socket.disconnect();
  }, []);

  async function refreshRooms() {
    const data = await api('/api/rooms/public');
    setRooms(data.rooms);
    setActiveRoom(data.activeRoom);
  }

  async function createRoom(event) {
    event.preventDefault();
    setError('');
    try {
      const data = await api('/api/rooms', { method: 'POST', body: form });
      navigate(`/rooms/${data.room.id}`);
    } catch (err) {
      setError(err.message);
    }
  }

  async function logout() {
    await api('/api/auth/logout', { method: 'POST' });
    setUser(null);
  }

  return (
    <Shell>
      <header className="topbar">
        <div>
          <p className="eyebrow">Lobby</p>
          <h1>房间大厅</h1>
        </div>
        <div className="topbar-actions">
          <span>{user.username}</span>
          <button className="ghost-btn" onClick={logout}>退出登录</button>
        </div>
      </header>
      <main className="lobby-grid">
        <section className="panel">
          <h2>创建房间</h2>
          <form className="stack-form" onSubmit={createRoom}>
            <input value={form.roomId} onChange={(event) => setForm({ ...form, roomId: event.target.value })} placeholder="自定义房间号，例如 team-01" />
            <input value={form.roomName} onChange={(event) => setForm({ ...form, roomName: event.target.value })} placeholder="房间名称" />
            <div className="inline-fields">
              <select value={form.visibility} onChange={(event) => setForm({ ...form, visibility: event.target.value })}>
                <option value="public">公开</option>
                <option value="private">私密</option>
              </select>
              <select value={form.maxMembers} onChange={(event) => setForm({ ...form, maxMembers: Number(event.target.value) })}>
                <option value={2}>2 人</option>
                <option value={5}>5 人</option>
                <option value={10}>10 人</option>
                <option value={20}>20 人</option>
              </select>
            </div>
            {error && <p className="form-error">{error}</p>}
            <button className="primary-btn" disabled={Boolean(activeRoom)}>创建并进入</button>
            {activeRoom && <p className="hint">你已经在房间 {activeRoom} 中，需要先退出后才能创建或加入其他房间。</p>}
          </form>
        </section>
        <section className="panel room-list-panel">
          <h2>实时房间列表</h2>
          <div className="room-list">
            {rooms.length === 0 && <p className="empty">暂无公开房间</p>}
            {rooms.map((room) => (
              <article className="room-card" key={room.id}>
                <div>
                  <h3>{room.roomName}</h3>
                  <p>#{room.id} · {room.onlineCount}/{room.maxMembers} 在线 · 房主 {room.owner?.username || '-'}</p>
                </div>
                <button className="primary-btn small" disabled={Boolean(activeRoom && activeRoom !== room.id)} onClick={() => navigate(`/join/${room.id}`)}>
                  加入
                </button>
              </article>
            ))}
          </div>
        </section>
      </main>
    </Shell>
  );
}

function JoinPage({ route, navigate }) {
  const [error, setError] = useState('');

  useEffect(() => {
    api(`/api/rooms/${route.roomId}/join`, {
      method: 'POST',
      body: { inviteToken: route.inviteToken }
    })
      .then(() => navigate(`/rooms/${route.roomId}`))
      .catch((err) => setError(err.message));
  }, [route.roomId, route.inviteToken]);

  return (
    <Shell>
      <div className="center-card">
        <h1>正在加入房间</h1>
        {error ? (
          <>
            <p className="form-error">{error}</p>
            <button className="primary-btn" onClick={() => navigate('/')}>返回大厅</button>
          </>
        ) : <p>请稍候...</p>}
      </div>
    </Shell>
  );
}

function RoomPage({ user, roomId, navigate }) {
  const [room, setRoom] = useState(null);
  const [objects, setObjects] = useState([]);
  const [messages, setMessages] = useState([]);
  const [error, setError] = useState('');
  const [tool, setTool] = useState('pen');
  const [color, setColor] = useState('#111827');
  const [size, setSize] = useState(4);
  const [chatText, setChatText] = useState('');
  const [receiverId, setReceiverId] = useState('');
  const [invite, setInvite] = useState(null);
  const socketRef = useRef(null);

  useEffect(() => {
    let mounted = true;
    api(`/api/rooms/${roomId}`)
      .then((data) => {
        if (!mounted) return;
        setRoom(data.room);
        setObjects(data.canvasObjects);
        setMessages(data.chatMessages);
      })
      .catch((err) => setError(err.message));

    const socket = io({ withCredentials: true });
    socketRef.current = socket;
    socket.on('connect', () => socket.emit('room:join', { roomId }));
    socket.on('room:state', setRoom);
    socket.on('chat:message', (message) => setMessages((current) => [...current, message]));
    socket.on('canvas:operation-applied', (operation) => {
      setObjects((current) => applyCanvasOp(current, operation));
    });
    socket.on('room:destroy-warning', (payload) => {
      setError(`房间将在 ${payload.secondsRemaining} 秒后自动销毁`);
    });
    socket.on('room:destroyed', () => {
      navigate('/');
    });
    return () => {
      mounted = false;
      socket.disconnect();
    };
  }, [roomId]);

  async function leaveRoom() {
    await api(`/api/rooms/${roomId}/leave`, { method: 'POST' });
    navigate('/');
  }

  async function createInvite() {
    const data = await api(`/api/rooms/${roomId}/invites`, { method: 'POST' });
    const link = roomLink(roomId, data.inviteToken);
    setInvite({ ...data, link });
    await navigator.clipboard?.writeText(link).catch(() => {});
  }

  function sendMessage(event) {
    event.preventDefault();
    if (!chatText.trim()) return;
    socketRef.current.emit('chat:send', {
      roomId,
      scope: receiverId ? 'private' : 'group',
      receiverId: receiverId || null,
      messageType: 'text',
      text: chatText
    }, (result) => {
      if (result?.error) setError(result.message || result.error);
    });
    setChatText('');
  }

  function sendImage(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > MAX_IMAGE_SIZE) {
      setError('图片不能超过 5MB');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      socketRef.current.emit('chat:send', {
        roomId,
        scope: receiverId ? 'private' : 'group',
        receiverId: receiverId || null,
        messageType: 'image',
        imageDataUrl: reader.result
      }, (result) => {
        if (result?.error) setError(result.message || result.error);
      });
    };
    reader.readAsDataURL(file);
  }

  if (error && !room) {
    return <Shell><div className="center-card"><p className="form-error">{error}</p><button className="primary-btn" onClick={() => navigate('/')}>返回大厅</button></div></Shell>;
  }

  if (!room) return <Shell><div className="loading">加载房间...</div></Shell>;

  const members = room.members || [];
  const isOwner = room.ownerId === user.id;
  const myPermissions = room.permissions || {};

  return (
    <Shell>
      <div className="room-layout">
        <header className="room-header">
          <div>
            <p className="eyebrow">#{room.id}</p>
            <h1>{room.roomName}</h1>
          </div>
          <div className="room-actions">
            <span>{room.onlineCount}/{room.maxMembers} 在线</span>
            {isOwner && <button className="ghost-btn" onClick={createInvite}>复制邀请链接</button>}
            <button className="ghost-btn" onClick={leaveRoom}>退出房间</button>
          </div>
        </header>
        {invite && <div className="invite-banner">邀请链接已生成，2 分钟内有效：{invite.link}</div>}
        {error && <div className="error-banner">{error}</div>}
        <aside className="tool-rail">
          <button className={tool === 'pen' ? 'active' : ''} onClick={() => setTool('pen')}>画笔</button>
          <button className={tool === 'eraser' ? 'active' : ''} onClick={() => setTool('eraser')}>橡皮</button>
          <button onClick={() => socketRef.current.emit('canvas:undo', { roomId })}>撤销</button>
          <button onClick={() => socketRef.current.emit('canvas:redo', { roomId })}>重做</button>
          <button onClick={() => socketRef.current.emit('canvas:operation', { roomId, operationType: 'clear', objectId: 'canvas', payload: {} })}>清空</button>
          <input type="color" value={color} onChange={(event) => setColor(event.target.value)} />
          <input type="range" min="1" max="40" value={size} onChange={(event) => setSize(Number(event.target.value))} />
        </aside>
        <Whiteboard
          user={user}
          roomId={roomId}
          objects={objects}
          setObjects={setObjects}
          socket={socketRef.current}
          tool={tool}
          color={color}
          size={size}
          canDraw={myPermissions.canDraw !== false}
        />
        <aside className="side-panel">
          <section>
            <h2>成员</h2>
            <div className="member-list">
              {members.map((member) => (
                <MemberRow key={member.userId} roomId={roomId} member={member} isOwner={isOwner} isSelf={member.userId === user.id} />
              ))}
            </div>
          </section>
          <section className="chat-panel">
            <h2>聊天</h2>
            <select value={receiverId} onChange={(event) => setReceiverId(event.target.value)}>
              <option value="">群组聊天</option>
              {members.filter((member) => member.userId !== user.id && !member.leftAt).map((member) => (
                <option key={member.userId} value={member.userId}>私聊 {member.user?.username}</option>
              ))}
            </select>
            <div className="message-list">
              {messages.map((message) => (
                <Message key={message.id} message={message} members={members} />
              ))}
            </div>
            <form className="chat-form" onSubmit={sendMessage}>
              <input value={chatText} onChange={(event) => setChatText(event.target.value)} placeholder={myPermissions.canChat === false ? '你已被禁言' : '输入消息'} disabled={myPermissions.canChat === false} />
              <label className="image-btn">
                图
                <input type="file" accept="image/*" hidden onChange={sendImage} disabled={myPermissions.canSendImages === false} />
              </label>
              <button>发送</button>
            </form>
          </section>
        </aside>
      </div>
    </Shell>
  );
}

function Whiteboard({ user, roomId, objects, setObjects, socket, tool, color, size, canDraw }) {
  const canvasRef = useRef(null);
  const draftRef = useRef(null);
  const [viewport, setViewport] = useState({ width: 1000, height: 700, dpr: window.devicePixelRatio || 1, zoom: 1, panX: 0, panY: 0 });
  const [drawing, setDrawing] = useState(false);
  const [draftVersion, setDraftVersion] = useState(0);
  const pointsRef = useRef([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const resize = () => {
      const rect = canvas.parentElement.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      setViewport((current) => ({ ...current, width: rect.width, height: rect.height, dpr }));
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  useEffect(() => {
    const ctx = canvasRef.current.getContext('2d');
    const draft = draftRef.current ? [{ id: 'draft', visible: true, payload: draftRef.current, type: 'stroke' }] : [];
    drawObjects(ctx, [...objects, ...draft], viewport);
  }, [objects, viewport, drawing, draftVersion]);

  function start(event) {
    if (!canDraw || !socket) return;
    const point = getCanvasPoint(event, canvasRef.current, viewport);
    pointsRef.current = [point];
    draftRef.current = createStrokeObject({ userId: user.id, tool, color, size, opacity: 1, points: pointsRef.current });
    setDrawing(true);
  }

  function move(event) {
    if (!drawing) return;
    event.preventDefault();
    const point = getCanvasPoint(event, canvasRef.current, viewport);
    pointsRef.current = [...pointsRef.current, point];
    draftRef.current = createStrokeObject({ userId: user.id, tool, color, size, opacity: 1, points: pointsRef.current });
    setDraftVersion((value) => value + 1);
  }

  function end() {
    if (!drawing) return;
    const payload = draftRef.current;
    draftRef.current = null;
    setDrawing(false);
    if (!payload || payload.points.length < 2) return;
    const objectId = crypto.randomUUID();
    const optimistic = { id: objectId, userId: user.id, type: 'stroke', payload, visible: true, createdAt: Date.now(), updatedAt: Date.now() };
    setObjects((current) => [...current, optimistic]);
    socket.emit('canvas:operation', {
      roomId,
      clientOperationId: crypto.randomUUID(),
      operationType: 'create',
      objectId,
      payload
    });
  }

  return (
    <main className={`whiteboard ${canDraw ? '' : 'disabled-board'}`}>
      {!canDraw && <div className="board-lock">你当前只能查看，不能操作画布</div>}
      <canvas
        ref={canvasRef}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
      />
    </main>
  );
}

function applyCanvasOp(objects, operation) {
  if (operation.operationType === 'clear') {
    return objects.map((object) => ({ ...object, visible: false }));
  }
  if (operation.operationType === 'create') {
    if (objects.some((object) => object.id === operation.objectId)) return objects;
    return [...objects, {
      id: operation.objectId,
      roomId: operation.roomId,
      userId: operation.userId,
      type: operation.payload.type || 'stroke',
      payload: operation.payload,
      visible: true,
      createdAt: operation.createdAt,
      updatedAt: operation.createdAt
    }];
  }
  if (['undo', 'delete'].includes(operation.operationType)) {
    return objects.map((object) => object.id === operation.objectId ? { ...object, visible: false } : object);
  }
  if (operation.operationType === 'redo') {
    return objects.map((object) => object.id === operation.objectId ? { ...object, visible: true } : object);
  }
  if (operation.operationType === 'update') {
    return objects.map((object) => object.id === operation.objectId ? { ...object, payload: { ...object.payload, ...operation.payload } } : object);
  }
  return objects;
}

function MemberRow({ roomId, member, isOwner, isSelf }) {
  const [busy, setBusy] = useState(false);
  const permissions = member.permissions || {};

  async function patchPermission(key) {
    setBusy(true);
    await api(`/api/rooms/${roomId}/members/${member.userId}/permissions`, {
      method: 'PATCH',
      body: { [key]: !permissions[key] }
    }).catch(() => {});
    setBusy(false);
  }

  async function kick() {
    setBusy(true);
    await api(`/api/rooms/${roomId}/members/${member.userId}/kick`, {
      method: 'POST',
      body: { banDurationMs: 10 * 60 * 1000, reason: '房主移出' }
    }).catch(() => {});
    setBusy(false);
  }

  return (
    <div className="member-row">
      <div>
        <strong>{member.user?.username || member.userId}</strong>
        <span>{member.role === 'owner' ? '房主' : member.online ? '在线' : '离线'}</span>
      </div>
      {isOwner && !isSelf && (
        <div className="member-actions">
          <button disabled={busy} onClick={() => patchPermission('canDraw')}>{permissions.canDraw ? '禁画' : '开画'}</button>
          <button disabled={busy} onClick={() => patchPermission('canChat')}>{permissions.canChat ? '禁言' : '开聊'}</button>
          <button disabled={busy} onClick={kick}>踢出</button>
        </div>
      )}
    </div>
  );
}

function Message({ message, members }) {
  const sender = members.find((member) => member.userId === message.senderId)?.user?.username || '未知用户';
  const receiver = members.find((member) => member.userId === message.receiverId)?.user?.username;
  return (
    <div className="message">
      <div className="message-meta">
        {sender}{message.scope === 'private' && receiver ? ` 私聊 ${receiver}` : ''} · {formatTime(message.createdAt)}
      </div>
      {message.messageType === 'image' ? <img src={message.imageDataUrl} alt="聊天图片" /> : <p>{message.text}</p>}
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
