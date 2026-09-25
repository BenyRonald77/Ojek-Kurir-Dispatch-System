import "dotenv/config";
import { createServer } from "http";
import next from "next";
import { Server as SocketIOServer } from "socket.io";
import { verifySession, SESSION_COOKIE_NAME } from "../src/lib/session-token";
import { setIO } from "../src/lib/socket-registry";
import { registerSocketHandlers } from "./socket-handlers";

const dev = process.env.NODE_ENV !== "production";
const port = Number(process.env.PORT ?? 3000);

const app = next({ dev });
const handle = app.getRequestHandler();

function parseCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  const match = header
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  if (!match) return null;
  return decodeURIComponent(match.slice(name.length + 1));
}

app.prepare().then(() => {
  const httpServer = createServer((req, res) => {
    handle(req, res);
  });

  const io = new SocketIOServer(httpServer, { path: "/socket.io" });

  io.use((socket, next) => {
    const token = parseCookie(socket.handshake.headers.cookie, SESSION_COOKIE_NAME);
    const session = token ? verifySession(token) : null;
    if (!session) {
      next(new Error("Unauthorized"));
      return;
    }
    socket.data.session = session;
    next();
  });

  registerSocketHandlers(io);
  setIO(io);

  httpServer.listen(port, () => {
    console.log(`> Server siap di http://localhost:${port} (Next.js + Socket.IO dispatch)`);
  });
});
