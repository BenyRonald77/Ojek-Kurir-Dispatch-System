import type { Server as SocketIOServer } from "socket.io";

// Next.js membundel API routes secara terpisah dari kode yang di-load langsung
// oleh tsx di server/index.ts, sehingga modul ini bisa punya DUA instance
// berbeda dalam satu proses Node yang sama (module duplication). Variabel
// module-level biasa TIDAK akan ter-share antar keduanya. globalThis dipakai
// di sini (sama seperti pola singleton Prisma client) karena ia benar-benar
// satu per-proses, bukan per-instance-modul.
const globalForIO = globalThis as unknown as {
  ioInstance: SocketIOServer | null | undefined;
};

export function setIO(io: SocketIOServer) {
  globalForIO.ioInstance = io;
}

export function getIO(): SocketIOServer | null {
  return globalForIO.ioInstance ?? null;
}
