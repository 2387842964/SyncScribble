# SyncScribble

实时协作绘图应用。多人同时在线绘制，画布内容实时同步。

## 功能

- **画笔 / 橡皮擦**：支持圆角、方角、平头三种笔触，可调粗细和透明度
- **八色预设 + 自定义取色器**
- **实时协作**：基于 Socket.IO，所有用户看到同一画布
- **缩放**：Ctrl+滚轮 / 双指捏合 / 底部按钮，笔画按矢量重绘保持清晰
- **平移**：右键拖拽 / 中键拖拽 / 放大后自动出现的滚动条
- **背景图**：上传图片作为画布背景，可随时清除
- **保存**：Ctrl+S 导出为 PNG
- **历史重放**：新加入的用户自动回放最近 5000 条绘图历史
- **响应式**：桌面侧边工具栏 / 手机底部滑出面板
- **在线人数**实时显示

## 快速启动

```bash
# 安装依赖
npm install

# 启动服务 (默认端口 3000)
npm start
```

打开浏览器访问 `http://localhost:3000`。

## 快捷键

| 按键 | 功能 |
|------|------|
| `P` | 画笔 |
| `E` | 橡皮擦 |
| `F` | 全屏 |
| `Ctrl+S` | 保存为 PNG |
| `Ctrl+0` | 重置缩放 |
| `Ctrl+滚轮` | 缩放 |
| 右键拖拽 | 平移画布 |
| 中键拖拽 | 平移画布 |

## 技术栈

- **后端**: Node.js + Express + Socket.IO
- **前端**: 原生 Canvas 2D API，无框架
- **通信协议**: WebSocket

## 项目结构

```
SyncScribble/
├── server.js          # 服务端：Express 静态服务 + Socket.IO 事件转发
├── package.json
└── public/
    ├── index.html      # 页面结构
    ├── app.js          # 画布核心逻辑：绘制、缩放、平移、同步
    └── style.css       # 样式：深色主题、响应式布局
```

## 部署

在服务器上安装依赖后，建议使用 systemd 管理进程，Nginx 反代 WebSocket：

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400;
    }

    location /socket.io/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400;
    }
}
```

## License

MIT
