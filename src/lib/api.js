export async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    ...options,
    body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.message || '请求失败');
    error.code = data.error;
    error.details = data.details;
    throw error;
  }
  return data;
}

export function formatTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit'
  });
}

export function roomLink(roomId, inviteToken) {
  const suffix = inviteToken ? `/${inviteToken}` : '';
  return `${window.location.origin}/join/${roomId}${suffix}`;
}
