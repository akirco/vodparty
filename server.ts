import http from 'node:http';
import path from 'node:path';
import dotenv from 'dotenv';
import express from 'express';
import Pusher from 'pusher';
import { Server as SocketIOServer } from 'socket.io';
import { createServer as createViteServer } from 'vite';
import { fetchUpstreamJson } from './src/shared/fetchJson.ts';

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;
  const server = http.createServer(app);
  // Allow list for the realtime transport. Defaults to same-origin only,
  // which covers the bundled SPA served by this process; set ALLOWED_ORIGINS
  // (comma-separated) when the client is hosted elsewhere.
  const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  const io = new SocketIOServer(server, {
    cors: allowedOrigins.length
      ? { origin: allowedOrigins }
      : { origin: false },
  });

  // Basic per-IP throttle on join-room, so one client cannot be used to
  // enumerate or flood arbitrary rooms.
  const joinAttempts = new Map<string, { count: number; resetAt: number }>();
  const JOIN_LIMIT = 20;
  const JOIN_WINDOW_MS = 60_000;

  const allowJoin = (ip: string) => {
    const now = Date.now();
    const entry = joinAttempts.get(ip);
    if (!entry || now > entry.resetAt) {
      joinAttempts.set(ip, { count: 1, resetAt: now + JOIN_WINDOW_MS });
      return true;
    }
    entry.count += 1;
    return entry.count <= JOIN_LIMIT;
  };

  io.on('connection', (socket) => {
    socket.on('join-room', (roomId) => {
      // Room ids are opaque client-generated strings; constrain the shape so
      // they cannot be used to probe the adapter with arbitrary keys.
      if (typeof roomId !== 'string' || !/^[a-z0-9-]{1,32}$/i.test(roomId)) {
        socket.disconnect(true);
        return;
      }
      if (!allowJoin(socket.handshake.address ?? 'unknown')) {
        socket.disconnect(true);
        return;
      }
      socket.join(roomId);
      socket.to(roomId).emit('user-joined', socket.id);
      const room = io.sockets.adapter.rooms.get(roomId);
      io.to(roomId).emit('room-size', room ? room.size : 0);
    });

    socket.on('video-action', (data) => {
      socket.to(data.roomId).emit('video-action', data);
    });

    socket.on('disconnecting', () => {
      socket.rooms.forEach((roomId) => {
        if (roomId !== socket.id) {
          socket.to(roomId).emit('user-left', socket.id);
          const room = io.sockets.adapter.rooms.get(roomId);
          io.to(roomId).emit('room-size', room ? room.size - 1 : 0);
        }
      });
    });
  });

  // API route to proxy requests to Apple CMS API.
  // Validation + fetching live in src/shared/fetchJson.ts so the Netlify
  // function and this server cannot drift apart.
  app.get('/api/proxy', async (req, res) => {
    const targetUrl = req.query.url as string | undefined;
    if (!targetUrl) {
      return res.status(400).json({ error: 'Missing url parameter' });
    }

    const { status, data } = await fetchUpstreamJson(targetUrl);
    res.status(status).json(data);
  });

  // Pusher private channel authentication
  const pusherServer = new Pusher({
    appId: process.env.PUSHER_APP_ID || '',
    key: process.env.PUSHER_KEY || '',
    secret: process.env.PUSHER_SECRET || '',
    cluster: process.env.PUSHER_CLUSTER || 'ap1',
    useTLS: true,
  });

  app.use(express.urlencoded({ extended: false }));

  app.post('/.netlify/functions/pusher-auth', (req, res) => {
    const { socket_id, channel_name } = req.body;
    if (!socket_id || !channel_name) {
      return res
        .status(400)
        .json({ error: 'Missing socket_id or channel_name' });
    }
    if (!channel_name.startsWith('private-party-')) {
      return res.status(403).json({ error: 'Unauthorized channel' });
    }
    const auth = pusherServer.authorizeChannel(socket_id, channel_name);
    res.json(auth);
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    // SPA fallback. Express 5 uses path-to-regexp v8, where a bare '*' pattern
    // throws ("Missing parameter name"), so this is registered as a terminal
    // middleware instead of a wildcard route.
    app.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return next();
      }
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
