import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { setDriverLocation, removeDriverLocation } from "@/lib/driver-geo";

const schema = z.object({
  online: z.boolean(),
  lat: z.number().optional(),
  lng: z.number().optional(),
});

export async function POST(request: NextRequest) {
  const user = await requireUser();
  if (!user || user.role !== "DRIVER" || !user.driverProfile) {
    return NextResponse.json({ error: "Hanya driver yang bisa mengubah status ini" }, { status: 403 });
  }

  const body = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Data tidak valid" }, { status: 400 });
  }

  const { online, lat, lng } = parsed.data;

  const hasActiveOrder = await prisma.order.findFirst({
    where: { assignedDriverId: user.id, status: { in: ["ASSIGNED", "PICKED_UP", "IN_TRANSIT"] } },
  });

  if (online) {
    if (lat === undefined || lng === undefined) {
      return NextResponse.json({ error: "lat & lng wajib diisi saat online" }, { status: 400 });
    }
    await prisma.driverProfile.update({
      where: { userId: user.id },
      data: { isOnline: true, isAvailable: !hasActiveOrder, lastLat: lat, lastLng: lng },
    });
    await setDriverLocation(user.id, lat, lng);
  } else {
    await prisma.driverProfile.update({
      where: { userId: user.id },
      data: { isOnline: false, isAvailable: false },
    });
    await removeDriverLocation(user.id);
  }

  return NextResponse.json({ ok: true });
}
