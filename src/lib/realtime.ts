import { getIO } from "./socket-registry";
import type { Order } from "@prisma/client";

export function notifyDriverOffer(driverId: string, offerId: string, order: Order, timeoutS: number) {
  const io = getIO();
  if (!io) return;
  io.to(`driver:${driverId}`).emit("offer:new", {
    offerId,
    orderId: order.id,
    pickupLat: order.pickupLat,
    pickupLng: order.pickupLng,
    dropoffLat: order.dropoffLat,
    dropoffLng: order.dropoffLng,
    timeoutS,
  });
}

export function broadcastOrderUpdate(orderId: string, payload: Record<string, unknown>) {
  const io = getIO();
  if (!io) return;
  io.to(`order:${orderId}`).emit("order:update", { orderId, ...payload });
}

export function broadcastDriverLocation(orderId: string, lat: number, lng: number) {
  const io = getIO();
  if (!io) return;
  io.to(`order:${orderId}`).emit("driver:location", { orderId, lat, lng, at: Date.now() });
}
