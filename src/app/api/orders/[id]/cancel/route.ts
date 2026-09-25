import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { cancelOfferWait } from "@/lib/offer-waiter";
import { broadcastOrderUpdate } from "@/lib/realtime";

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (!user) {
    return NextResponse.json({ error: "Belum login" }, { status: 401 });
  }

  const order = await prisma.order.findUnique({ where: { id: params.id } });
  if (!order || order.customerId !== user.id) {
    return NextResponse.json({ error: "Order tidak ditemukan" }, { status: 404 });
  }

  if (order.status !== "PENDING" && order.status !== "OFFERING") {
    return NextResponse.json({ error: "Order sudah tidak bisa dibatalkan" }, { status: 400 });
  }

  await prisma.order.update({ where: { id: order.id }, data: { status: "CANCELLED" } });

  const pendingOffer = await prisma.orderOffer.findFirst({
    where: { orderId: order.id, status: "PENDING" },
  });

  if (pendingOffer) {
    await prisma.driverProfile.update({
      where: { userId: pendingOffer.driverId },
      data: { isAvailable: true },
    });
    await prisma.orderOffer.update({
      where: { id: pendingOffer.id },
      data: { status: "REJECTED", respondedAt: new Date() },
    });
    cancelOfferWait(pendingOffer.id);
  }

  broadcastOrderUpdate(order.id, { status: "CANCELLED" });

  return NextResponse.json({ ok: true });
}
