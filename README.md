# Synchive - 同步视频播放平台

一个现代化的视频同步播放应用，支持多人实时同步观看视频、搜索、历史记录和个性化设置。

## 快速开始

### 前置要求

- Node.js
- pnpm（推荐）或 npm

### 安装依赖

```bash
pnpm install
```

### 开发模式

开启开发服务器（运行在 http://localhost:3000）：

```bash
pnpm dev
```

### 生产构建

构建应用并创建优化的生产包：

```bash
pnpm build
```

## 功能

### 实时同步播放

使用Socket.IO实现多用户房间功能：

- 用户可以加入特定房间
- 播放器操作（播放、暂停、进度条调整）实时同步到房间内其他用户
- 自动检测用户加入和离开

### API代理

服务器提供`/api/proxy`端点用于跨域API请求，支持请求Apple CMS API等外部服务。

### Wathcparty

集成Pusher和Socket.IO实现实时通知和事件推送。

## 环境变量

创建`.env`文件（或`.env.local`），配置以下变量：

```env
# Pusher配置
PUSHER_APP_ID=your_app_id
PUSHER_KEY=your_key
PUSHER_SECRET=your_secret
PUSHER_CLUSTER=your_cluster
```

### Pusher配置要点

**重要：** 在Pusher Dashboard设置中需要启用 **"Enable Client Events"**，这样才能允许客户端之间直接通信。

配置步骤：

1. 登录 [Pusher Dashboard](https://dashboard.pusher.com)
2. 选择你的App
3. 进入 "APP Settings"
4. 启用 "Enable Client Events" 选项

## 部署

### Netlify部署

项目已配置Netlify部署：

访问 [Netlify](https://www.netlify.com/)

### Docker部署

```dockerfile
# 示例Dockerfile配置，自行配置
FROM node:18-alpine
WORKDIR /app
COPY . .
RUN pnpm install
RUN pnpm build
CMD ["pnpm", "start"]
```

## API

### Socket.IO事件

- `join-room` - 加入播放房间
- `video-action` - 视频播放操作同步
- `user-joined` - 用户加入事件
- `user-left` - 用户离开事件
- `room-size` - 房间用户数更新

### HTTP端点

- `GET /api/proxy?url=<target_url>` - 代理API请求

## 许可证

MIT

---

> 欢迎提交Issue和Pull Request！

## 声明

> SyncHive 不托管任何文件，仅从第三方服务拉取流媒体。法律问题应由文件托管方和提供商解决。SyncHive 对视频提供商播放的任何媒体文件概不负责。请注意，SyncHive 不提供任何视频文件的下载或存储。所有视频均来自第三方网站，SyncHive 不对其内容负责。我们不鼓励或支持任何侵犯版权的行为。使用 SyncHive 即表示您同意遵守当地法律法规

> 本仓库跟另一个next.js项目重名了所以叫vodparty
