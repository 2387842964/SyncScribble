const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const drawingHistory = [];
const MAX_HISTORY = 5000;

function broadcastUserCount() {
    io.emit('userCount', io.engine.clientsCount);
  }

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id} (Total: ${io.engine.clientsCount})`);

  socket.emit('history', drawingHistory);
  broadcastUserCount();

  socket.on('drawStart', (data) => {
    drawingHistory.push({ type: 'drawStart', ...data, id: socket.id });
    if (drawingHistory.length > MAX_HISTORY) drawingHistory.shift();
    socket.broadcast.emit('drawStart', { ...data, id: socket.id });
  });

  socket.on('drawMove', (data) => {
    drawingHistory.push({ type: 'drawMove', ...data, id: socket.id });
    if (drawingHistory.length > MAX_HISTORY) drawingHistory.shift();
    socket.broadcast.emit('drawMove', { ...data, id: socket.id });
  });

  socket.on('drawEnd', (data) => {
    drawingHistory.push({ type: 'drawEnd', ...data, id: socket.id });
    if (drawingHistory.length > MAX_HISTORY) drawingHistory.shift();
    socket.broadcast.emit('drawEnd', { ...data, id: socket.id });
  });

  socket.on('clearCanvas', () => {
    drawingHistory.length = 0;
    socket.broadcast.emit('clearCanvas');
    io.emit('systemMessage', `Canvas cleared by a user`);
  });

  socket.on('setBackground', (dataUrl) => {
    drawingHistory.push({ type: 'setBackground', dataUrl });
    if (drawingHistory.length > MAX_HISTORY) drawingHistory.shift();
    socket.broadcast.emit('setBackground', dataUrl);
  });

  socket.on('clearBackground', () => {
    drawingHistory.push({ type: 'clearBackground' });
    if (drawingHistory.length > MAX_HISTORY) drawingHistory.shift();
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