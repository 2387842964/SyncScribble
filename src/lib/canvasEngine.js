export function createStrokeObject({ userId, tool, color, size, opacity, points }) {
  return {
    type: 'stroke',
    userId,
    tool,
    color,
    size,
    opacity,
    points
  };
}

export function drawObjects(ctx, objects, viewport) {
  const { dpr, zoom, panX, panY, width, height } = viewport;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width * dpr, height * dpr);
  ctx.restore();

  ctx.save();
  ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, panX * dpr, panY * dpr);
  for (const object of objects) {
    if (!object.visible) continue;
    if (object.type === 'stroke') drawStroke(ctx, object.payload || object);
    if (object.type === 'text') drawText(ctx, object.payload || object);
    if (object.type === 'shape') drawShape(ctx, object.payload || object);
  }
  ctx.restore();
}

function drawStroke(ctx, stroke) {
  const points = stroke.points || [];
  if (points.length < 2) return;
  ctx.save();
  ctx.globalAlpha = Number(stroke.opacity || 1);
  ctx.lineWidth = Number(stroke.size || 4);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : 'source-over';
  ctx.strokeStyle = stroke.tool === 'eraser' ? 'rgba(0,0,0,1)' : stroke.color || '#111827';
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index += 1) {
    ctx.lineTo(points[index].x, points[index].y);
  }
  ctx.stroke();
  ctx.restore();
}

function drawText(ctx, textObject) {
  ctx.save();
  ctx.globalAlpha = Number(textObject.opacity || 1);
  ctx.fillStyle = textObject.color || '#111827';
  ctx.font = `${Number(textObject.size || 22)}px "Noto Sans SC", sans-serif`;
  ctx.fillText(textObject.text || '', Number(textObject.x || 0), Number(textObject.y || 0));
  ctx.restore();
}

function drawShape(ctx, shape) {
  ctx.save();
  ctx.globalAlpha = Number(shape.opacity || 1);
  ctx.lineWidth = Number(shape.size || 3);
  ctx.strokeStyle = shape.color || '#111827';
  const x = Number(shape.x || 0);
  const y = Number(shape.y || 0);
  const w = Number(shape.w || 0);
  const h = Number(shape.h || 0);
  if (shape.shape === 'ellipse') {
    ctx.beginPath();
    ctx.ellipse(x + w / 2, y + h / 2, Math.abs(w / 2), Math.abs(h / 2), 0, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    ctx.strokeRect(x, y, w, h);
  }
  ctx.restore();
}

export function getCanvasPoint(event, canvas, viewport) {
  const rect = canvas.getBoundingClientRect();
  const clientX = event.clientX ?? event.touches?.[0]?.clientX;
  const clientY = event.clientY ?? event.touches?.[0]?.clientY;
  return {
    x: (clientX - rect.left - viewport.panX) / viewport.zoom,
    y: (clientY - rect.top - viewport.panY) / viewport.zoom
  };
}
