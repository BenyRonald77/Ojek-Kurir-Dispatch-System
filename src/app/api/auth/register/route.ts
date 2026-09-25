import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { hashPassword, signSession, SESSION_COOKIE_NAME, getSessionCookieOptions } from "@/lib/auth";
import { USER_ROLES } from "@/lib/types";

const registerSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(6),
  role: z.enum(USER_ROLES),
  vehicleType: z.string().min(2).optional(),
});

export async function POST(request: NextRequest) {
  const body = await request.json();
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Data tidak valid", details: parsed.error.flatten() }, { status: 400 });
  }

  const { name, email, password, role, vehicleType } = parsed.data;

  if (role === "DRIVER" && !vehicleType) {
    return NextResponse.json({ error: "vehicleType wajib diisi untuk driver" }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: "Email sudah terdaftar" }, { status: 409 });
  }

  const passwordHash = await hashPassword(password);
  const user = await prisma.user.create({
    data: {
      name,
      email,
      passwordHash,
      role,
      driverProfile:
        role === "DRIVER"
          ? { create: { vehicleType: vehicleType!, isOnline: false, isAvailable: false } }
          : undefined,
    },
  });

  const token = signSession({ sub: user.id, name: user.name, email: user.email, role: user.role as never });
  const response = NextResponse.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  response.cookies.set(SESSION_COOKIE_NAME, token, getSessionCookieOptions());
  return response;
}
