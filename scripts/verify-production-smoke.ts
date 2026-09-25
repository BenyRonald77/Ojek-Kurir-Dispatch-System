import "dotenv/config";
import { io as ioClient, Socket } from "socket.io-client";
import { prisma } from "../src/lib/prisma";
import { signSession } from "../src/lib/session-token";

const SERVER_URL = process.env.VERIFY_SERVER_URL ?? "http://localhost:3000";

function connectAs(userId: string, name: string, email: string, role: "CUSTOMER" | "DRIVER"): Socket {
  const token = signSession({ sub: userId, name, email, role });
  return ioClient(SERVER_URL, { path: "/socket.io", extraHeaders: { Cookie: `ojek_session=${token}` }, transports: ["websocket"] });
}

async function main() {
  const driver1 = await prisma.user.findUniqueOrThrow({ where: { email: "driver1@ojek.dev" } });
  const customer = await prisma.user.findUniqueOrThrow({ where: { email: "customer@ojek.dev" } });
  await prisma.driverProfile.update({ where: { userId: driver1.id }, data: { isOnline: true, isAvailable: true } });

  const pickup = { lat: -6.1754, lng: 106.8272 };
  const driverSocket = connectAs(driver1.id, driver1.name, driver1.email, "DRIVER");
  await new Promise<void>((resolve) => driverSocket.on("connect", () => resolve()));
  driverSocket.emit("driver:location", pickup);
  await new Promise((r) => setTimeout(r, 300));

  driverSocket.on("offer:new", (payload: { offerId: string }) => {
    driverSocket.emit("offer:respond", { offerId: payload.offerId, accept: true });
  });

  const token = signSession({ sub: customer.id, name: customer.name, email: customer.email, role: "CUSTOMER" });
  const response = await fetch(`${SERVER_URL}/api/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: `ojek_session=${token}` },
    body: JSON.stringify({ pickupLat: pickup.lat, pickupLng: pickup.lng, dropoffLat: pickup.lat + 0.02, dropoffLng: pickup.lng + 0.02 }),
  });
  const data = (await response.json()) as { order: { id: string } };
  await new Promise((r) => setTimeout(r, 1500));

  const order = await prisma.order.findUniqueOrThrow({ where: { id: data.order.id } });
  if (order.status !== "ASSIGNED" || order.assignedDriverId !== driver1.id) {
    throw new Error(`GAGAL: order seharusnya ASSIGNED, didapat status=${order.status}`);
  }
  console.log("[verify] BERHASIL (mode production): order berhasil di-assign ke driver end-to-end.");

  driverSocket.disconnect();
  await prisma.$disconnect();
  process.exit(0);
}

main().catch((error) => {
  console.error("[verify] ERROR:", error);
  process.exit(1);
});
