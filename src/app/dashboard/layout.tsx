import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { LogoutButton } from "./logout-button";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = getSession();
  if (!session) {
    redirect("/login");
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <span className="text-lg font-bold text-brand-700">Ojek/Kurir Dispatch</span>
          <div className="flex items-center gap-4 text-sm text-slate-600">
            <span>
              {session.name} ({session.role === "CUSTOMER" ? "Pelanggan" : "Driver"})
            </span>
            <LogoutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-6 py-6">{children}</main>
    </div>
  );
}
