import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { broadcastOrderUpdate } from "@/lib/realtime";

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  ASSIGNED: ["PICKED_UP"],
  PICKED_UP: ["IN_TRANSIT"],
  IN_TRANSIT: ["COMPLETED"],
};

const schema = z.object({
  status: z.enum(["PICKED_UP", "IN_TRANSIT", "COMPLETED"]),
});

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (!user || user.role !== "DRIVER") {
    return NextResponse.json({ error: "Hanya driver yang bisa mengubah status ini" }, { status: 403 });
  }

  const body = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Data tidak valid" }, { status: 400 });
  }

  const order = await prisma.order.findUnique({ where: { id: params.id } });
  if (!order || order.assignedDriverId !== user.id) {
    return NextResponse.json({ error: "Order tidak ditemukan" }, { status: 404 });
  }

  const allowedNext = ALLOWED_TRANSITIONS[order.status] ?? [];
  if (!allowedNext.includes(parsed.data.status)) {
    return NextResponse.json(
      { error: `Tidak bisa pindah dari ${order.status} ke ${parsed.data.status}` },
      { status: 400 }
    );
  }

  await prisma.order.update({ where: { id: order.id }, data: { status: parsed.data.status } });

  if (parsed.data.status === "COMPLETED") {
    await prisma.driverProfile.update({ where: { userId: user.id }, data: { isAvailable: true } });
  }

  broadcastOrderUpdate(order.id, { status: parsed.data.status });

  return NextResponse.json({ ok: true });
}
