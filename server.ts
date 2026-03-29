import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import http from "http";
import { Server as SocketIOServer } from "socket.io";

async function startServer() {
  const app = express();
  const PORT = 3000;
  const server = http.createServer(app);
  const io = new SocketIOServer(server, {
    cors: { origin: "*" }
  });

  io.on("connection", (socket) => {
    socket.on("join-room", (roomId) => {
      socket.join(roomId);
      socket.to(roomId).emit("user-joined", socket.id);
      const room = io.sockets.adapter.rooms.get(roomId);
      io.to(roomId).emit("room-size", room ? room.size : 0);
    });

    socket.on("video-action", (data) => {
      socket.to(data.roomId).emit("video-action", data);
    });

    socket.on("disconnecting", () => {
      socket.rooms.forEach(roomId => {
        if (roomId !== socket.id) {
          socket.to(roomId).emit("user-left", socket.id);
          const room = io.sockets.adapter.rooms.get(roomId);
          io.to(roomId).emit("room-size", room ? room.size - 1 : 0);
        }
      });
    });
  });

  // API route to proxy requests to Apple CMS API
  app.get("/api/proxy", async (req, res) => {
    const targetUrl = req.query.url as string;
    if (!targetUrl) {
      return res.status(400).json({ error: "Missing url parameter" });
    }

    try {
      const response = await fetch(targetUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          "Accept": "application/json, text/plain, */*",
        },
      });
      
      if (!response.ok) {
        return res.status(response.status).json({ error: `Proxy failed with status ${response.status}` });
      }

      const data = await response.json();
      res.json(data);
    } catch (error) {
      console.warn(`[Proxy] Failed to fetch from ${targetUrl}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      res.status(500).json({ error: "Failed to fetch from target URL" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
