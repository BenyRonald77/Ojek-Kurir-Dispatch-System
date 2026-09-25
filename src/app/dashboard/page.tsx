import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";

export default function DashboardIndexPage() {
  const session = getSession();
  if (!session) redirect("/login");
  redirect(session.role === "CUSTOMER" ? "/dashboard/customer" : "/dashboard/driver");
}
