const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 8 * 1024 * 1024
});

app.use(express.static('public'));

const drawingHistory = [];
const MAX_HISTORY = 5000;
const MAX_BACKGROUND_DATA_URL_LENGTH = 6 * 1024 * 1024;

function addHistory(action) {
  drawingHistory.push(action);
  const overflow = drawingHistory.length - MAX_HISTORY;
  if (overflow > 0) {
    drawingHistory.splice(0, overflow);
  }
}

function withSocketId(socket, data) {
  return { ...data, id: socket.id };
}

function isValidBackground(dataUrl) {
  return (
    typeof dataUrl === 'string' &&
    dataUrl.startsWith('data:image/') &&
    dataUrl.length <= MAX_BACKGROUND_DATA_URL_LENGTH
  );
}

function broadcastUserCount() {
  io.emit('userCount', io.engine.clientsCount);
}

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id} (Total: ${io.engine.clientsCount})`);

  socket.emit('history', drawingHistory);
  broadcastUserCount();

  socket.on('drawStart', (data) => {
    const event = withSocketId(socket, data);
    addHistory({ type: 'drawStart', ...event });
    socket.broadcast.emit('drawStart', event);
  });

  socket.on('drawMove', (data) => {
    const event = withSocketId(socket, data);
    addHistory({ type: 'drawMove', ...event });
    socket.broadcast.emit('drawMove', event);
  });

  socket.on('drawEnd', (data) => {
    const event = withSocketId(socket, data);
    addHistory({ type: 'drawEnd', ...event });
    socket.broadcast.emit('drawEnd', event);
  });

  socket.on('clearCanvas', () => {
    drawingHistory.length = 0;
    socket.broadcast.emit('clearCanvas');
    io.emit('systemMessage', `Canvas cleared by a user`);
  });

  socket.on('setBackground', (dataUrl) => {
    if (!isValidBackground(dataUrl)) {
      socket.emit('systemMessage', 'Background image is invalid or too large');
      return;
    }
    addHistory({ type: 'setBackground', dataUrl });
    socket.broadcast.emit('setBackground', dataUrl);
  });

  socket.on('clearBackground', () => {
    addHistory({ type: 'clearBackground' });
    socket.broadcast.emit('clearBackground');
  });

  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id} (Total: ${io.engine.clientsCount})`);
    broadcastUserCount();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`SyncScribble server running at http://localhost:${PORT}`);
});
