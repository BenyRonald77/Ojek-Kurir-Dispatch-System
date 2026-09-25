import "dotenv/config";
import { io as ioClient, Socket } from "socket.io-client";
import { prisma } from "../src/lib/prisma";
import { signSession } from "../src/lib/session-token";

const SERVER_URL = process.env.VERIFY_SERVER_URL ?? "http://localhost:3000";

function connectAs(userId: string, name: string, email: string, role: "CUSTOMER" | "DRIVER"): Socket {
  const token = signSession({ sub: userId, name, email, role });
  return ioClient(SERVER_URL, {
    path: "/socket.io",
    extraHeaders: { Cookie: `ojek_session=${token}` },
    transports: ["websocket"],
  });
}

async function main() {
  const driver1 = await prisma.user.findUniqueOrThrow({ where: { email: "driver1@ojek.dev" } });
  const customer = await prisma.user.findUniqueOrThrow({ where: { email: "customer@ojek.dev" } });

  // Bersihkan order aktif driver1 dari test sebelumnya (jika ada) agar tidak
  // ambigu order mana yang sedang aktif untuk driver ini.
  await prisma.order.updateMany({
    where: { assignedDriverId: driver1.id, status: { in: ["ASSIGNED", "PICKED_UP", "IN_TRANSIT"] } },
    data: { status: "COMPLETED" },
  });

  // Buat order dummy yang sudah ASSIGNED langsung ke driver1 (tidak lewat dispatch,
  // supaya test ini murni fokus menguji broadcast lokasi, bukan alur dispatch).
  const order = await prisma.order.create({
    data: {
      customerId: customer.id,
      pickupLat: -6.1754,
      pickupLng: 106.8272,
      dropoffLat: -6.2,
      dropoffLng: 106.85,
      status: "ASSIGNED",
      assignedDriverId: driver1.id,
    },
  });

  const driverSocket = connectAs(driver1.id, driver1.name, driver1.email, "DRIVER");
  const customerSocket = connectAs(customer.id, customer.name, customer.email, "CUSTOMER");

  await Promise.all([driverSocket, customerSocket].map((s) => new Promise<void>((resolve) => s.on("connect", () => resolve()))));

  customerSocket.emit("order:join", { orderId: order.id });
  await new Promise((r) => setTimeout(r, 300));

  const receivedLocations: { lat: number; lng: number }[] = [];
  customerSocket.on("driver:location", (payload: { orderId: string; lat: number; lng: number }) => {
    if (payload.orderId === order.id) {
      receivedLocations.push({ lat: payload.lat, lng: payload.lng });
      console.log(`[verify] Pelanggan menerima update lokasi driver #${receivedLocations.length}: ${payload.lat}, ${payload.lng}`);
    }
  });

  const path = [
    { lat: -6.1754, lng: 106.8272 },
    { lat: -6.178, lng: 106.83 },
    { lat: -6.185, lng: 106.84 },
    { lat: -6.2, lng: 106.85 },
  ];

  console.log("[verify] Driver mengirim 4 update lokasi berurutan (simulasi bergerak menuju tujuan)...");
  for (const point of path) {
    driverSocket.emit("driver:location", point);
    await new Promise((r) => setTimeout(r, 400));
  }

  await new Promise((r) => setTimeout(r, 500));

  if (receivedLocations.length !== path.length) {
    throw new Error(`GAGAL: pelanggan seharusnya menerima ${path.length} update lokasi, didapat ${receivedLocations.length}`);
  }

  for (let i = 0; i < path.length; i++) {
    if (receivedLocations[i].lat !== path[i].lat || receivedLocations[i].lng !== path[i].lng) {
      throw new Error(`GAGAL: update lokasi ke-${i + 1} tidak sesuai urutan pengiriman driver`);
    }
  }

  console.log(
    "[verify] BERHASIL: semua update lokasi driver diterima pelanggan secara realtime, berurutan, dan sesuai posisi yang dikirim."
  );

  driverSocket.disconnect();
  customerSocket.disconnect();
  await prisma.order.delete({ where: { id: order.id } });
  await prisma.$disconnect();
  process.exit(0);
}

main().catch((error) => {
  console.error("[verify] ERROR:", error);
  process.exit(1);
});
