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
  const driver2 = await prisma.user.findUniqueOrThrow({ where: { email: "driver2@ojek.dev" } });
  const customer = await prisma.user.findUniqueOrThrow({ where: { email: "customer@ojek.dev" } });

  // Reset state driver agar bisa online kembali dari test sebelumnya.
  await prisma.driverProfile.updateMany({
    where: { userId: { in: [driver1.id, driver2.id] } },
    data: { isOnline: true, isAvailable: true },
  });

  const pickup = { lat: -6.1754, lng: 106.8272 };

  const socket1 = connectAs(driver1.id, driver1.name, driver1.email, "DRIVER");
  const socket2 = connectAs(driver2.id, driver2.name, driver2.email, "DRIVER");
  const customerSocket = connectAs(customer.id, customer.name, customer.email, "CUSTOMER");

  await Promise.all(
    [socket1, socket2, customerSocket].map(
      (s) => new Promise<void>((resolve) => s.on("connect", () => resolve()))
    )
  );
  console.log("[verify] Tiga koneksi socket siap (driver1=dekat, driver2=jauh, customer).");

  // driver1 lebih dekat ke titik jemput daripada driver2.
  socket1.emit("driver:location", { lat: pickup.lat + 0.001, lng: pickup.lng }); // ~111m
  socket2.emit("driver:location", { lat: pickup.lat + 0.02, lng: pickup.lng }); // ~2.2km
  await new Promise((r) => setTimeout(r, 500));

  let receivedByDriver1 = false;
  let receivedByDriver2 = false;

  socket1.on("offer:new", () => {
    receivedByDriver1 = true;
    console.log("[verify] driver1 (terdekat) menerima tawaran - SENGAJA TIDAK MERESPONS untuk simulasi timeout.");
    // Sengaja tidak merespons sama sekali.
  });

  socket2.on("offer:new", (payload: { offerId: string }) => {
    receivedByDriver2 = true;
    console.log("[verify] driver2 (berikutnya) menerima tawaran setelah driver1 timeout - MENERIMA.");
    socket2.emit("offer:respond", { offerId: payload.offerId, accept: true });
  });

  let finalAssignedDriverId: string | null = null;
  customerSocket.on("order:update", (payload: { status: string; assignedDriverId?: string }) => {
    if (payload.status === "ASSIGNED" && payload.assignedDriverId) {
      finalAssignedDriverId = payload.assignedDriverId;
    }
  });

  const orderResponse = await fetch(`${SERVER_URL}/api/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: `ojek_session=${signSession({ sub: customer.id, name: customer.name, email: customer.email, role: "CUSTOMER" })}` },
    body: JSON.stringify({ pickupLat: pickup.lat, pickupLng: pickup.lng, dropoffLat: pickup.lat + 0.05, dropoffLng: pickup.lng + 0.05 }),
  });
  const orderData = (await orderResponse.json()) as { order: { id: string } };
  const orderId = orderData.order.id;
  console.log(`[verify] Order dibuat: ${orderId}`);
  customerSocket.emit("order:join", { orderId });

  // Tunggu cukup lama untuk timeout driver1 (5 detik dari .env) + proses offer ke driver2.
  await new Promise((r) => setTimeout(r, 8000));

  if (!receivedByDriver1) throw new Error("GAGAL: driver1 (terdekat) tidak pernah menerima tawaran pertama");
  if (!receivedByDriver2) throw new Error("GAGAL: driver2 tidak menerima tawaran susulan setelah driver1 timeout");

  const offers = await prisma.orderOffer.findMany({ where: { orderId }, orderBy: { offeredAt: "asc" } });
  console.log("[verify] Riwayat OrderOffer:", offers.map((o) => `${o.driverId === driver1.id ? "driver1" : "driver2"}:${o.status}`));

  if (offers.length !== 2) throw new Error(`GAGAL: seharusnya ada 2 offer, didapat ${offers.length}`);
  if (offers[0].driverId !== driver1.id || offers[0].status !== "TIMEOUT") {
    throw new Error("GAGAL: offer pertama seharusnya ke driver1 dengan status TIMEOUT");
  }
  if (offers[1].driverId !== driver2.id || offers[1].status !== "ACCEPTED") {
    throw new Error("GAGAL: offer kedua seharusnya ke driver2 dengan status ACCEPTED");
  }
  if (finalAssignedDriverId !== driver2.id) {
    throw new Error(`GAGAL: order seharusnya di-assign ke driver2, didapat ${finalAssignedDriverId}`);
  }

  console.log(
    "[verify] BERHASIL: order ditawarkan berurutan (driver1 timeout -> driver2 menerima), sesuai urutan jarak, tercatat lengkap di OrderOffer."
  );

  socket1.disconnect();
  socket2.disconnect();
  customerSocket.disconnect();
  await prisma.$disconnect();
  process.exit(0);
}

main().catch((error) => {
  console.error("[verify] ERROR:", error);
  process.exit(1);
});
