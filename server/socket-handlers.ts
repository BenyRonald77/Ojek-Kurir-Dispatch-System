import type { Server as SocketIOServer, Socket } from "socket.io";
import { prisma } from "../src/lib/prisma";
import { setDriverLocation } from "../src/lib/driver-geo";
import { resolveOfferResponse } from "../src/lib/offer-waiter";
import { broadcastDriverLocation } from "../src/lib/realtime";
import type { SessionPayload } from "../src/lib/session-token";

export function registerSocketHandlers(io: SocketIOServer) {
  io.on("connection", (socket: Socket) => {
    const session = socket.data.session as SessionPayload;

    if (session.role === "DRIVER") {
      socket.join(`driver:${session.sub}`);
    }

    socket.on("order:join", async (payload: { orderId: string }) => {
      const order = await prisma.order.findUnique({ where: { id: payload.orderId } });
      if (!order) return;
      if (order.customerId !== session.sub && order.assignedDriverId !== session.sub) return;
      socket.join(`order:${payload.orderId}`);
    });

    socket.on("driver:location", async (payload: { lat: number; lng: number }) => {
      if (session.role !== "DRIVER") return;
      await setDriverLocation(session.sub, payload.lat, payload.lng);

      const activeOrder = await prisma.order.findFirst({
        where: { assignedDriverId: session.sub, status: { in: ["ASSIGNED", "PICKED_UP", "IN_TRANSIT"] } },
      });
      if (activeOrder) {
        broadcastDriverLocation(activeOrder.id, payload.lat, payload.lng);
      }
    });

    socket.on("offer:respond", async (payload: { offerId: string; accept: boolean }) => {
      if (session.role !== "DRIVER") return;
      const offer = await prisma.orderOffer.findUnique({ where: { id: payload.offerId } });
      if (!offer || offer.driverId !== session.sub || offer.status !== "PENDING") return;
      resolveOfferResponse(payload.offerId, payload.accept);
    });
  });
}
