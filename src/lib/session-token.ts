import jwt from "jsonwebtoken";
import type { UserRole } from "./types";

const JWT_SECRET = process.env.JWT_SECRET ?? "dev-secret-do-not-use-in-production";
export const SESSION_COOKIE_NAME = "ojek_session";

export interface SessionPayload {
  sub: string;
  name: string;
  email: string;
  role: UserRole;
}

export function signSession(payload: SessionPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
}

export function verifySession(token: string): SessionPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as SessionPayload;
  } catch {
    return null;
  }
}

export function getSessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  };
}
