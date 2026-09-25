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

async function createOrder(customerId: string, name: string, email: string, pickup: { lat: number; lng: number }) {
  const token = signSession({ sub: customerId, name, email, role: "CUSTOMER" });
  const response = await fetch(`${SERVER_URL}/api/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: `ojek_session=${token}` },
    body: JSON.stringify({
      pickupLat: pickup.lat,
      pickupLng: pickup.lng,
      dropoffLat: pickup.lat + 0.05,
      dropoffLng: pickup.lng + 0.05,
    }),
  });
  const data = (await response.json()) as { order: { id: string } };
  return data.order.id;
}

async function main() {
  const driver1 = await prisma.user.findUniqueOrThrow({ where: { email: "driver1@ojek.dev" } });
  const customer = await prisma.user.findUniqueOrThrow({ where: { email: "customer@ojek.dev" } });

  await prisma.driverProfile.update({ where: { userId: driver1.id }, data: { isOnline: true, isAvailable: true } });

  const pickup = { lat: -6.1754, lng: 106.8272 };
  const driverSocket = connectAs(driver1.id, driver1.name, driver1.email, "DRIVER");

  await new Promise<void>((resolve) => driverSocket.on("connect", () => resolve()));
  driverSocket.emit("driver:location", { lat: pickup.lat, lng: pickup.lng });
  await new Promise((r) => setTimeout(r, 500));

  const receivedOfferIds: string[] = [];
  driverSocket.on("offer:new", (payload: { offerId: string }) => {
    receivedOfferIds.push(payload.offerId);
    console.log(`[verify] driver1 menerima tawaran offerId=${payload.offerId} (total diterima: ${receivedOfferIds.length})`);
  });

  console.log("[verify] Membuat DUA order hampir bersamaan, hanya ada SATU driver online...");
  const [orderIdA, orderIdB] = await Promise.all([
    createOrder(customer.id, customer.name, customer.email, pickup),
    createOrder(customer.id, customer.name, customer.email, pickup),
  ]);
  console.log(`[verify] Order A=${orderIdA}, Order B=${orderIdB}`);

  await new Promise((r) => setTimeout(r, 2000));

  // Driver hanya boleh menerima SATU dari dua tawaran (tidak boleh dapat dua tawaran aktif sekaligus).
  if (receivedOfferIds.length !== 1) {
    throw new Error(
      `GAGAL: driver menerima ${receivedOfferIds.length} tawaran sekaligus, seharusnya cuma 1 (one-order-one-driver dilanggar)`
    );
  }
  console.log("[verify] Driver hanya menerima SATU tawaran pada satu waktu - sesuai jaminan one-order-one-driver.");

  const offerId = receivedOfferIds[0];
  const offer = await prisma.orderOffer.findUniqueOrThrow({ where: { id: offerId } });
  const winningOrderId = offer.orderId;
  const losingOrderId = winningOrderId === orderIdA ? orderIdB : orderIdA;

  driverSocket.emit("offer:respond", { offerId, accept: true });
  await new Promise((r) => setTimeout(r, 1000));

  const winningOrder = await prisma.order.findUniqueOrThrow({ where: { id: winningOrderId } });
  if (winningOrder.status !== "ASSIGNED" || winningOrder.assignedDriverId !== driver1.id) {
    throw new Error(`GAGAL: order pemenang (${winningOrderId}) seharusnya ASSIGNED ke driver1`);
  }
  console.log(`[verify] Order pemenang (${winningOrderId}) berhasil ASSIGNED ke driver1.`);

  // Order yang kalah harus jatuh ke NO_DRIVER_FOUND (karena driver1 satu-satunya driver online, sudah dipakai).
  await new Promise((r) => setTimeout(r, 6000));
  const losingOrder = await prisma.order.findUniqueOrThrow({ where: { id: losingOrderId } });
  if (losingOrder.status !== "NO_DRIVER_FOUND") {
    throw new Error(`GAGAL: order yang kalah (${losingOrderId}) seharusnya NO_DRIVER_FOUND, didapat ${losingOrder.status}`);
  }
  console.log(`[verify] Order yang kalah (${losingOrderId}) berakhir NO_DRIVER_FOUND (driver1 sudah terpakai order lain).`);

  console.log(
    "[verify] BERHASIL: dua order dibuat bersamaan, driver hanya pernah menerima satu tawaran aktif pada satu waktu - jaminan one-order-one-driver terbukti."
  );

  driverSocket.disconnect();
  await prisma.$disconnect();
  process.exit(0);
}

main().catch((error) => {
  console.error("[verify] ERROR:", error);
  process.exit(1);
});
