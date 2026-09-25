import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { dispatchOrder } from "@/lib/dispatch-service";

const createOrderSchema = z.object({
  pickupLat: z.number(),
  pickupLng: z.number(),
  dropoffLat: z.number(),
  dropoffLng: z.number(),
});

export async function POST(request: NextRequest) {
  const user = await requireUser();
  if (!user || user.role !== "CUSTOMER") {
    return NextResponse.json({ error: "Hanya pelanggan yang bisa membuat order" }, { status: 403 });
  }

  const body = await request.json();
  const parsed = createOrderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Data tidak valid" }, { status: 400 });
  }

  const order = await prisma.order.create({
    data: { customerId: user.id, ...parsed.data, status: "PENDING" },
  });

  dispatchOrder(order.id).catch((error) => {
    console.error(`[dispatch] gagal memproses order ${order.id}:`, error);
  });

  return NextResponse.json({ order }, { status: 201 });
}

export async function GET() {
  const user = await requireUser();
  if (!user) {
    return NextResponse.json({ error: "Belum login" }, { status: 401 });
  }

  const orders = await prisma.order.findMany({
    where: user.role === "CUSTOMER" ? { customerId: user.id } : { assignedDriverId: user.id },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return NextResponse.json({ orders });
}
