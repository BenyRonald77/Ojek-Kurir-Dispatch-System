import { prisma } from "./prisma";
import { findNearestDrivers } from "./driver-geo";
import { waitForOfferResponse } from "./offer-waiter";
import { notifyDriverOffer, broadcastOrderUpdate } from "./realtime";

const SEARCH_RADIUS_M = Number(process.env.DISPATCH_SEARCH_RADIUS_M ?? 5000);
const OFFER_TIMEOUT_S = Number(process.env.DISPATCH_OFFER_TIMEOUT_S ?? 15);

async function releaseDriver(driverId: string) {
  await prisma.driverProfile.update({ where: { userId: driverId }, data: { isAvailable: true } });
}

/**
 * Menawarkan order secara berurutan ke driver terdekat. Setiap kandidat
 * "direbut" lewat conditional UPDATE atomik (isAvailable: true -> false)
 * SEBELUM ditawarkan - ini yang menjamin satu driver tidak pernah punya dua
 * tawaran order aktif sekaligus, bahkan jika dispatchOrder dijalankan untuk
 * beberapa order secara bersamaan.
 */
export async function dispatchOrder(orderId: string) {
  const initialOrder = await prisma.order.findUnique({ where: { id: orderId } });
  if (!initialOrder || initialOrder.status !== "PENDING") return;

  const { pickupLat, pickupLng } = initialOrder;
  const excluded: string[] = [];

  while (true) {
    const currentOrder = await prisma.order.findUnique({ where: { id: orderId } });
    if (!currentOrder || currentOrder.status === "CANCELLED") return;

    const candidates = await findNearestDrivers(pickupLat, pickupLng, SEARCH_RADIUS_M, excluded);

    if (candidates.length === 0) {
      await prisma.order.update({ where: { id: orderId }, data: { status: "NO_DRIVER_FOUND" } });
      broadcastOrderUpdate(orderId, { status: "NO_DRIVER_FOUND" });
      return;
    }

    const candidate = candidates[0];
    excluded.push(candidate.driverId);

    const reserved = await prisma.driverProfile.updateMany({
      where: { userId: candidate.driverId, isAvailable: true },
      data: { isAvailable: false },
    });

    if (reserved.count === 0) {
      // Direbut proses dispatch order lain (atau sudah tidak available) - lanjut ke kandidat berikutnya.
      continue;
    }

    const orderBeforeOffer = await prisma.order.findUnique({ where: { id: orderId } });
    if (!orderBeforeOffer || orderBeforeOffer.status === "CANCELLED") {
      await releaseDriver(candidate.driverId);
      return;
    }

    const offer = await prisma.orderOffer.create({
      data: { orderId, driverId: candidate.driverId, status: "PENDING" },
    });

    await prisma.order.update({ where: { id: orderId }, data: { status: "OFFERING" } });
    broadcastOrderUpdate(orderId, {
      status: "OFFERING",
      offeredDriverId: candidate.driverId,
      distanceM: candidate.distanceM,
    });
    notifyDriverOffer(candidate.driverId, offer.id, orderBeforeOffer, OFFER_TIMEOUT_S);

    const result = await waitForOfferResponse(offer.id, OFFER_TIMEOUT_S * 1000);

    if (result === "ACCEPTED") {
      const orderNow = await prisma.order.findUnique({ where: { id: orderId } });
      if (!orderNow || orderNow.status === "CANCELLED") {
        // Dibatalkan pelanggan tepat saat driver menerima - lepas driver, jangan tetapkan.
        await releaseDriver(candidate.driverId);
        await prisma.orderOffer.update({
          where: { id: offer.id },
          data: { status: "REJECTED", respondedAt: new Date() },
        });
        return;
      }

      await prisma.orderOffer.update({
        where: { id: offer.id },
        data: { status: "ACCEPTED", respondedAt: new Date() },
      });
      await prisma.order.update({
        where: { id: orderId },
        data: { status: "ASSIGNED", assignedDriverId: candidate.driverId },
      });
      broadcastOrderUpdate(orderId, { status: "ASSIGNED", assignedDriverId: candidate.driverId });
      return;
    }

    if (result === "CANCELLED") {
      // releaseDriver sudah dilakukan oleh endpoint cancel; cukup hentikan loop.
      return;
    }

    // REJECTED atau TIMEOUT: lepas kembali driver, lanjut ke kandidat berikutnya.
    await releaseDriver(candidate.driverId);
    await prisma.orderOffer.update({
      where: { id: offer.id },
      data: { status: result, respondedAt: new Date() },
    });
    broadcastOrderUpdate(orderId, { status: "OFFERING", offerResult: result, driverId: candidate.driverId });
  }
}
