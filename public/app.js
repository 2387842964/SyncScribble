(function () {
  'use strict';

  const socket = io();

  const bgCanvas = document.getElementById('bgCanvas');
  const bgCtx = bgCanvas.getContext('2d');
  const drawCanvas = document.getElementById('drawCanvas');
  const drawCtx = drawCanvas.getContext('2d');
  const canvasArea = document.getElementById('canvasArea');
  const zoomWrapper = document.getElementById('canvasZoomWrapper');
  const placeholder = document.getElementById('canvasPlaceholder');
  const userCountEl = document.getElementById('userCount');
  const connStatusEl = document.getElementById('connectionStatus');
  const toastEl = document.getElementById('toast');

  const bgImageInput = document.getElementById('bgImageInput');
  const scrollbarH = document.getElementById('scrollbarH');
  const scrollbarV = document.getElementById('scrollbarV');
  const scrollbarThumbH = document.getElementById('scrollbarThumbH');
  const scrollbarThumbV = document.getElementById('scrollbarThumbV');

  let bgImage = null;
  let zoom = 1;
  let panX = 0, panY = 0;

  const localHistory = [];
  const MAX_LOCAL_HISTORY = 5000;

  const drawState = {
    tool: 'pen',
    color: '#000000',
    size: 4,
    lineCap: 'round',
    opacity: 1,
    drawing: false,
    lastX: 0,
    lastY: 0,
    hasContent: false
  };

  const remoteStates = {};

  let toastTimer = null;

  function getDpr() {
    return window.devicePixelRatio || 1;
  }

  function resizeCanvas() {
    const rect = canvasArea.getBoundingClientRect();
    const dpr = getDpr();
    const w = rect.width;
    const h = rect.height;

    if (drawCanvas.width !== w * dpr || drawCanvas.height !== h * dpr) {
      const oldDrawData = drawCtx.getImageData(0, 0, drawCanvas.width, drawCanvas.height);

      [bgCanvas, drawCanvas].forEach(c => {
        c.width = w * dpr;
        c.height = h * dpr;
        c.style.width = w + 'px';
        c.style.height = h + 'px';
      });

      updateCanvasTransforms(dpr);
      redrawBackground();
      drawCtx.putImageData(oldDrawData, 0, 0);
    }
  }

  function updateCanvasTransforms(dpr) {
    dpr = dpr || getDpr();
    const t = dpr * zoom;
    drawCtx.setTransform(t, 0, 0, t, panX * dpr, panY * dpr);
    bgCtx.setTransform(t, 0, 0, t, panX * dpr, panY * dpr);
  }

  function redrawBackground() {
    const dpr = getDpr();
    const cssW = bgCanvas.width / dpr;
    const cssH = bgCanvas.height / dpr;

    bgCtx.save();
    bgCtx.setTransform(1, 0, 0, 1, 0, 0);
    bgCtx.clearRect(0, 0, bgCanvas.width, bgCanvas.height);
    bgCtx.restore();

    if (bgImage) {
      bgCtx.save();
      const t = dpr * zoom;
      bgCtx.setTransform(t, 0, 0, t, panX * dpr, panY * dpr);
      bgCtx.drawImage(bgImage, -panX / zoom, -panY / zoom, cssW / zoom, cssH / zoom);
      bgCtx.restore();
    }

    updateCanvasTransforms(dpr);
  }

  function replayLocalHistory() {
    const dpr = getDpr();

    drawCtx.save();
    drawCtx.setTransform(1, 0, 0, 1, 0, 0);
    drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
    drawCtx.restore();

    bgCtx.save();
    bgCtx.setTransform(1, 0, 0, 1, 0, 0);
    bgCtx.clearRect(0, 0, bgCanvas.width, bgCanvas.height);
    bgCtx.restore();

    let lastBgAction = null;
    for (const action of localHistory) {
      if (action.type === 'setBackground' || action.type === 'clearBackground') {
        lastBgAction = action;
      }
    }

    if (lastBgAction && lastBgAction.type === 'setBackground' && lastBgAction.dataUrl) {
      bgCtx.save();
      const cssW = bgCanvas.width / dpr;
      const cssH = bgCanvas.height / dpr;
      const t = dpr * zoom;
      bgCtx.setTransform(t, 0, 0, t, panX * dpr, panY * dpr);
      bgCtx.drawImage(bgImage, -panX / zoom, -panY / zoom, cssW / zoom, cssH / zoom);
      bgCtx.restore();
    }

    updateCanvasTransforms(dpr);

    const remoteStatesReplay = {};
    for (const action of localHistory) {
      if (action.type === 'drawStart' && action.id) {
        remoteStatesReplay[action.id] = { ...action };
      } else if (action.type === 'drawMove') {
        if (action.id && !remoteStatesReplay[action.id]) {
          remoteStatesReplay[action.id] = { prevX: action.x, prevY: action.y, ...action };
        }
        const prev = remoteStatesReplay[action.id];
        if (prev) {
          drawLine(action, drawCtx);
          remoteStatesReplay[action.id] = { ...prev, prevX: action.x, prevY: action.y };
        } else {
          drawLine({ ...action, prevX: action.x, prevY: action.y }, drawCtx);
        }
      } else if (action.type === 'drawEnd' && action.id) {
        delete remoteStatesReplay[action.id];
      }
    }
  }

  function getPos(e) {
    const rect = canvasArea.getBoundingClientRect();
    const cx = (e.clientX || (e.touches && e.touches[0].clientX)) - rect.left;
    const cy = (e.clientY || (e.touches && e.touches[0].clientY)) - rect.top;
    return {
      x: (cx - panX) / zoom,
      y: (cy - panY) / zoom
    };
  }

  function getCanvasScale() {
    return {
      x: (drawCanvas.width / getDpr()) / drawCanvas.clientWidth,
      y: (drawCanvas.height / getDpr()) / drawCanvas.clientHeight
    };
  }

  function startDrawing(e) {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    drawState.drawing = true;
    const pos = getPos(e);
    const scale = getCanvasScale();
    drawState.lastX = pos.x * scale.x;
    drawState.lastY = pos.y * scale.y;

    const data = {
      x: drawState.lastX,
      y: drawState.lastY,
      color: drawState.color,
      size: drawState.size,
      lineCap: drawState.lineCap,
      opacity: drawState.opacity,
      tool: drawState.tool
    };

    remoteStates[socket.id] = { ...data };
    localHistory.push({ type: 'drawStart', ...data, id: socket.id });
    while (localHistory.length > MAX_LOCAL_HISTORY) localHistory.shift();
    socket.emit('drawStart', data);
  }

  function moveDrawing(e) {
    if (!drawState.drawing) return;
    e.preventDefault();
    const pos = getPos(e);
    const scale = getCanvasScale();
    const x = pos.x * scale.x;
    const y = pos.y * scale.y;

    const data = {
      x,
      y,
      prevX: drawState.lastX,
      prevY: drawState.lastY,
      color: drawState.color,
      size: drawState.size,
      lineCap: drawState.lineCap,
      opacity: drawState.opacity,
      tool: drawState.tool
    };

    drawLine(data, drawCtx);
    drawState.lastX = x;
    drawState.lastY = y;
    drawState.hasContent = true;
    updatePlaceholder();

    localHistory.push({ type: 'drawMove', ...data, id: socket.id });
    while (localHistory.length > MAX_LOCAL_HISTORY) localHistory.shift();
    socket.emit('drawMove', data);
  }

  function stopDrawing(e) {
    if (!drawState.drawing) return;
    drawState.drawing = false;
    socket.emit('drawEnd', {});
  }

  function drawLine(data, targetCtx) {
    targetCtx.save();
    targetCtx.globalAlpha = data.opacity;
    targetCtx.lineWidth = data.size;
    targetCtx.lineCap = data.lineCap;

    if (data.tool === 'eraser') {
      targetCtx.globalCompositeOperation = 'destination-out';
      targetCtx.strokeStyle = 'rgba(0,0,0,1)';
    } else {
      targetCtx.globalCompositeOperation = 'source-over';
      targetCtx.strokeStyle = data.color;
    }

    targetCtx.beginPath();
    targetCtx.moveTo(data.prevX, data.prevY);
    targetCtx.lineTo(data.x, data.y);
    targetCtx.stroke();
    targetCtx.restore();
  }

  function handleRemoteDrawStart(data) {
    remoteStates[data.id] = { ...data };
    localHistory.push({ type: 'drawStart', ...data });
    while (localHistory.length > MAX_LOCAL_HISTORY) localHistory.shift();
  }

  function handleRemoteDrawMove(data) {
    if (!remoteStates[data.id]) {
      remoteStates[data.id] = { prevX: data.x, prevY: data.y, ...data };
    }
    const prev = remoteStates[data.id];
    drawLine(data, drawCtx);
    remoteStates[data.id] = { ...prev, prevX: data.x, prevY: data.y };
    localHistory.push({ type: 'drawMove', ...data });
    while (localHistory.length > MAX_LOCAL_HISTORY) localHistory.shift();
    drawState.hasContent = true;
    updatePlaceholder();
  }

  function handleRemoteDrawEnd(data) {
    delete remoteStates[data.id];
  }

  function setTool(tool) {
    drawState.tool = tool;
    document.getElementById('penTool').classList.toggle('active', tool === 'pen');
    document.getElementById('eraserTool').classList.toggle('active', tool === 'eraser');
    drawCanvas.style.cursor = tool === 'eraser' ? 'cell' : 'crosshair';
  }

  function setColor(color) {
    drawState.color = color;
    document.querySelectorAll('.color-swatch').forEach(sw => {
      sw.classList.toggle('active', sw.dataset.color === color);
    });
    document.getElementById('customColor').value = color;
  }

  function setSize(size) {
    drawState.size = parseInt(size);
    document.getElementById('brushSize').value = size;
    document.getElementById('brushSizeValue').textContent = size + 'px';
  }

  function setLineCap(cap) {
    drawState.lineCap = cap;
    document.querySelectorAll('.style-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.style === cap);
    });
  }

  function setOpacity(value) {
    drawState.opacity = parseInt(value) / 100;
    document.getElementById('opacity').value = value;
    document.getElementById('opacityValue').textContent = value + '%';
  }

  function clearCanvas(silent) {
    drawCtx.save();
    drawCtx.setTransform(1, 0, 0, 1, 0, 0);
    drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
    drawCtx.restore();
    updateCanvasTransforms();
    localHistory.length = 0;
    drawState.hasContent = bgImage !== null;
    updatePlaceholder();
    if (!silent) {
      socket.emit('clearCanvas');
    }
  }

  function clearBackground(silent) {
    if (!bgImage) return;
    bgImage = null;
    redrawBackground();
    localHistory.push({ type: 'clearBackground' });
    while (localHistory.length > MAX_LOCAL_HISTORY) localHistory.shift();
    drawState.hasContent = false;
    updatePlaceholder();
    showToast('Background image cleared');
    if (!silent) {
      socket.emit('clearBackground');
    }
  }

  function saveCanvas() {
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = bgCanvas.width;
    tempCanvas.height = bgCanvas.height;
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.drawImage(bgCanvas, 0, 0);
    tempCtx.drawImage(drawCanvas, 0, 0);

    const link = document.createElement('a');
    link.download = 'syncscribble-' + Date.now() + '.png';
    link.href = tempCanvas.toDataURL('image/png');
    link.click();
    showToast('Image saved!');
  }

  function setBackgroundImage(file) {
    const reader = new FileReader();
    reader.onload = function (ev) {
      const img = new Image();
      img.onload = function () {
        bgImage = img;
        redrawBackground();
        localHistory.push({ type: 'setBackground', dataUrl: ev.target.result });
        while (localHistory.length > MAX_LOCAL_HISTORY) localHistory.shift();
        drawState.hasContent = true;
        updatePlaceholder();
        showToast('Background image set!');
        socket.emit('setBackground', ev.target.result);
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      canvasArea.requestFullscreen().catch(() => {});
    }
  }

  function clampPan() {
    const rect = canvasArea.getBoundingClientRect();
    const maxPanX = rect.width * (zoom - 1);
    const maxPanY = rect.height * (zoom - 1);
    panX = Math.max(-maxPanX, Math.min(0, panX));
    panY = Math.max(-maxPanY, Math.min(0, panY));
  }

  function updateScrollbars() {
    if (zoom <= 1) {
      scrollbarH.classList.remove('visible');
      scrollbarV.classList.remove('visible');
      return;
    }
    scrollbarH.classList.add('visible');
    scrollbarV.classList.add('visible');

    const rect = canvasArea.getBoundingClientRect();
    const trackW = scrollbarH.clientWidth;
    const trackH = scrollbarV.clientHeight;
    const tw = Math.max(trackW / zoom, 24);
    const th = Math.max(trackH / zoom, 24);
    const maxPanX = rect.width * (zoom - 1);
    const maxPanY = rect.height * (zoom - 1);
    const ratioX = maxPanX === 0 ? 0 : -panX / maxPanX;
    const ratioY = maxPanY === 0 ? 0 : -panY / maxPanY;
    const posX = Math.max(0, Math.min(1, ratioX)) * (trackW - tw);
    const posY = Math.max(0, Math.min(1, ratioY)) * (trackH - th);

    scrollbarThumbH.style.width = tw + 'px';
    scrollbarThumbH.style.left = posX + 'px';
    scrollbarThumbV.style.height = th + 'px';
    scrollbarThumbV.style.top = posY + 'px';
  }

  function applyView() {
    clampPan();
    replayLocalHistory();
    updateScrollbars();
    document.getElementById('zoomValue').textContent = Math.round(zoom * 100) + '%';
  }

  function setZoom(newZoom, cx, cy) {
    const oldZoom = zoom;
    zoom = Math.max(0.1, Math.min(5, newZoom));
    panX = cx - (cx - panX) * (zoom / oldZoom);
    panY = cy - (cy - panY) * (zoom / oldZoom);
    applyView();
  }

  function resetZoom() {
    zoom = 1;
    panX = 0;
    panY = 0;
    applyView();
  }

  function updatePlaceholder() {
    placeholder.classList.toggle('hidden', drawState.hasContent);
  }

  function showToast(msg) {
    if (toastTimer) clearTimeout(toastTimer);
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    toastTimer = setTimeout(() => {
      toastEl.classList.remove('show');
    }, 2000);
  }

  socket.on('connect', () => {
    connStatusEl.textContent = '● Connected';
    connStatusEl.classList.remove('disconnected');
    resizeCanvas();
  });

  socket.on('disconnect', () => {
    connStatusEl.textContent = '● Disconnected';
    connStatusEl.classList.add('disconnected');
  });

  socket.on('connect_error', () => {
    connStatusEl.textContent = '● Reconnecting...';
    connStatusEl.classList.add('disconnected');
  });

  socket.on('history', (history) => {
    localHistory.length = 0;
    for (const action of history) {
      localHistory.push(action);
    }
    while (localHistory.length > MAX_LOCAL_HISTORY) localHistory.shift();

    for (const action of history) {
      if (action.type === 'setBackground' && action.dataUrl) {
        const img = new Image();
        img.onload = function () {
          bgImage = img;
        };
        img.src = action.dataUrl;
      } else if (action.type === 'clearBackground') {
        bgImage = null;
      }
    }

    replayLocalHistory();

    drawState.hasContent = history.length > 0;
    updatePlaceholder();
  });

  socket.on('drawStart', handleRemoteDrawStart);
  socket.on('drawMove', handleRemoteDrawMove);
  socket.on('drawEnd', handleRemoteDrawEnd);

  socket.on('clearCanvas', () => {
    localHistory.length = 0;
    bgImage = null;
    drawCtx.save();
    drawCtx.setTransform(1, 0, 0, 1, 0, 0);
    drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
    drawCtx.restore();
    updateCanvasTransforms();
    redrawBackground();
    drawState.hasContent = false;
    updatePlaceholder();
    showToast('Canvas cleared');
  });

  socket.on('setBackground', (dataUrl) => {
    const img = new Image();
    img.onload = function () {
      bgImage = img;
      localHistory.push({ type: 'setBackground', dataUrl: dataUrl });
      while (localHistory.length > MAX_LOCAL_HISTORY) localHistory.shift();
      redrawBackground();
      drawState.hasContent = true;
      updatePlaceholder();
      showToast('Background image synced');
    };
    img.src = dataUrl;
  });

  socket.on('clearBackground', () => {
    bgImage = null;
    localHistory.push({ type: 'clearBackground' });
    while (localHistory.length > MAX_LOCAL_HISTORY) localHistory.shift();
    redrawBackground();
    drawState.hasContent = false;
    updatePlaceholder();
    showToast('Background image cleared');
  });

  socket.on('userCount', (count) => {
    userCountEl.textContent = '🟢 ' + count + ' 位用户在线';
  });

  socket.on('systemMessage', (msg) => {
    showToast(msg);
  });

  drawCanvas.addEventListener('mousedown', startDrawing);
  drawCanvas.addEventListener('mousemove', moveDrawing);
  drawCanvas.addEventListener('mouseup', stopDrawing);
  drawCanvas.addEventListener('mouseleave', stopDrawing);

  let pinchState = null;

  drawCanvas.addEventListener('touchstart', (e) => {
    const touches = e.touches;
    if (touches.length === 1) {
      pinchState = null;
      startDrawing(e);
    } else if (touches.length === 2) {
      if (drawState.drawing) stopDrawing(e);
      const t1 = touches[0], t2 = touches[1];
      const mid = getTouchMid(t1, t2);
      const rect = canvasArea.getBoundingClientRect();
      pinchState = {
        dist: getTouchDist(t1, t2),
        zoom: zoom,
        panX: panX,
        panY: panY,
        midX: mid.x - rect.left,
        midY: mid.y - rect.top
      };
    }
  }, { passive: false });

  drawCanvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    const touches = e.touches;
    if (touches.length === 1 && drawState.drawing) {
      moveDrawing(e);
    } else if (touches.length === 2 && pinchState) {
      const t1 = touches[0], t2 = touches[1];
      const newDist = getTouchDist(t1, t2);
      const scale = newDist / pinchState.dist;
      const newZoom = Math.max(0.1, Math.min(5, pinchState.zoom * scale));
      const mid = getTouchMid(t1, t2);
      const rect = canvasArea.getBoundingClientRect();
      const mx = mid.x - rect.left;
      const my = mid.y - rect.top;
      panX = mx - (pinchState.midX - pinchState.panX) * (newZoom / pinchState.zoom);
      panY = my - (pinchState.midY - pinchState.panY) * (newZoom / pinchState.zoom);
      zoom = newZoom;
      applyView();
    }
  }, { passive: false });

  drawCanvas.addEventListener('touchend', (e) => {
    if (drawState.drawing) {
      stopDrawing(e);
    }
    if (e.touches.length < 2) {
      pinchState = null;
    }
  });

  function getTouchDist(t1, t2) {
    const dx = t1.clientX - t2.clientX;
    const dy = t1.clientY - t2.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function getTouchMid(t1, t2) {
    return {
      x: (t1.clientX + t2.clientX) / 2,
      y: (t1.clientY + t2.clientY) / 2
    };
  }

  let panning = false, panStartX = 0, panStartY = 0, panOrigX = 0, panOrigY = 0;
  let scrollbarDragging = null, scrollbarDragStart = 0, scrollbarDragPan = 0;

  canvasArea.addEventListener('mousedown', (e) => {
    if (e.button === 1 || e.button === 2) {
      e.preventDefault();
      panning = true;
      panStartX = e.clientX;
      panStartY = e.clientY;
      panOrigX = panX;
      panOrigY = panY;
      drawCanvas.style.cursor = 'grabbing';
    }
  });

  window.addEventListener('mousemove', function onPanMove(e) {
    if (!panning) return;
    panX = panOrigX + (e.clientX - panStartX);
    panY = panOrigY + (e.clientY - panStartY);
    applyView();
  });

  window.addEventListener('mouseup', () => {
    if (panning) {
      panning = false;
      drawCanvas.style.cursor = drawState.tool === 'eraser' ? 'cell' : 'crosshair';
    }
    if (scrollbarDragging) {
      scrollbarDragging = null;
      document.body.style.userSelect = '';
    }
  });

  canvasArea.addEventListener('contextmenu', (e) => e.preventDefault());

  // Scrollbar thumb drag
  scrollbarThumbH.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    scrollbarDragging = 'h';
    scrollbarDragStart = e.clientX;
    scrollbarDragPan = panX;
    document.body.style.userSelect = 'none';
  });

  scrollbarThumbV.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    scrollbarDragging = 'v';
    scrollbarDragStart = e.clientY;
    scrollbarDragPan = panY;
    document.body.style.userSelect = 'none';
  });

  // Scrollbar track click (jump)
  scrollbarH.addEventListener('mousedown', (e) => {
    if (e.target === scrollbarThumbH) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = scrollbarH.getBoundingClientRect();
    const tw = scrollbarThumbH.clientWidth;
    const trackW = scrollbarH.clientWidth;
    if (trackW <= tw) return;
    const clickRatio = (e.clientX - rect.left - tw / 2) / (trackW - tw);
    const areaRect = canvasArea.getBoundingClientRect();
    panX = -clickRatio * areaRect.width * (zoom - 1);
    applyView();
  });

  scrollbarV.addEventListener('mousedown', (e) => {
    if (e.target === scrollbarThumbV) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = scrollbarV.getBoundingClientRect();
    const th = scrollbarThumbV.clientHeight;
    const trackH = scrollbarV.clientHeight;
    if (trackH <= th) return;
    const clickRatio = (e.clientY - rect.top - th / 2) / (trackH - th);
    const areaRect = canvasArea.getBoundingClientRect();
    panY = -clickRatio * areaRect.height * (zoom - 1);
    applyView();
  });

  window.addEventListener('mousemove', function onScrollbarMove(e) {
    if (!scrollbarDragging) return;
    const areaRect = canvasArea.getBoundingClientRect();
    if (scrollbarDragging === 'h') {
      const trackW = scrollbarH.clientWidth;
      const tw = scrollbarThumbH.clientWidth;
      if (trackW <= tw) return;
      const delta = e.clientX - scrollbarDragStart;
      const panRange = areaRect.width * (zoom - 1);
      const panPerPixel = panRange / (trackW - tw);
      panX = scrollbarDragPan - delta * panPerPixel;
    } else {
      const trackH = scrollbarV.clientHeight;
      const th = scrollbarThumbV.clientHeight;
      if (trackH <= th) return;
      const delta = e.clientY - scrollbarDragStart;
      const panRange = areaRect.height * (zoom - 1);
      const panPerPixel = panRange / (trackH - th);
      panY = scrollbarDragPan - delta * panPerPixel;
    }
    applyView();
  });

  window.addEventListener('resize', resizeCanvas);

  document.getElementById('penTool').addEventListener('click', () => setTool('pen'));
  document.getElementById('eraserTool').addEventListener('click', () => setTool('eraser'));

  document.querySelectorAll('.color-swatch').forEach(sw => {
    sw.addEventListener('click', () => setColor(sw.dataset.color));
  });

  document.getElementById('customColor').addEventListener('input', (e) => {
    setColor(e.target.value);
    document.querySelectorAll('.color-swatch').forEach(sw => sw.classList.remove('active'));
  });

  document.getElementById('brushSize').addEventListener('input', (e) => setSize(e.target.value));

  document.querySelectorAll('.style-btn').forEach(btn => {
    btn.addEventListener('click', () => setLineCap(btn.dataset.style));
  });

  document.getElementById('opacity').addEventListener('input', (e) => setOpacity(e.target.value));

  document.getElementById('clearBtn').addEventListener('click', () => {
    if (confirm('Clear the entire canvas? This affects all users.')) {
      clearCanvas(false);
      bgImage = null;
      redrawBackground();
      drawState.hasContent = false;
      updatePlaceholder();
    }
  });

  document.getElementById('saveBtn').addEventListener('click', saveCanvas);
  document.getElementById('bgImageBtn').addEventListener('click', () => bgImageInput.click());
  document.getElementById('clearBgBtn').addEventListener('click', () => clearBackground(false));
  document.getElementById('fullscreenBtn').addEventListener('click', toggleFullscreen);

  bgImageInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      setBackgroundImage(e.target.files[0]);
    }
  });

  const toolbar = document.getElementById('toolbar');
  const toolbarToggle = document.getElementById('toolbarToggle');

  toolbarToggle.addEventListener('click', () => {
    toolbar.classList.toggle('open');
  });

  drawCanvas.addEventListener('click', () => {
    if (toolbar.classList.contains('open')) {
      toolbar.classList.remove('open');
    }
  });

  document.getElementById('zoomInBtn').addEventListener('click', () => {
    const rect = canvasArea.getBoundingClientRect();
    setZoom(zoom * 1.25, rect.width / 2, rect.height / 2);
  });
  document.getElementById('zoomOutBtn').addEventListener('click', () => {
    const rect = canvasArea.getBoundingClientRect();
    setZoom(zoom / 1.25, rect.width / 2, rect.height / 2);
  });
  document.getElementById('zoomResetBtn').addEventListener('click', resetZoom);
  document.getElementById('zoomValue').addEventListener('click', resetZoom);

  canvasArea.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const rect = canvasArea.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    setZoom(e.deltaY > 0 ? zoom / 1.1 : zoom * 1.1, cx, cy);
  }, { passive: false });

  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    switch (e.key.toLowerCase()) {
      case 'p': setTool('pen'); break;
      case 'e': setTool('eraser'); break;
      case 'f': toggleFullscreen(); break;
      case 's': if (e.ctrlKey || e.metaKey) { e.preventDefault(); saveCanvas(); } break;
      case '0': if (e.ctrlKey || e.metaKey) { e.preventDefault(); resetZoom(); } break;
    }
  });

  resizeCanvas();
  applyView();
  setTool('pen');
  setColor('#000000');
  setSize(4);
  setLineCap('round');
  setOpacity(100);
})();
