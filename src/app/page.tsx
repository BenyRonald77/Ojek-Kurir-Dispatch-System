import Link from "next/link";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-6 px-6 text-center">
      <h1 className="text-3xl font-bold text-brand-700">
        Ojek/Kurir Dispatch System
      </h1>
      <p className="text-slate-600">
        Order langsung dicarikan driver terdekat, ditawarkan berurutan dengan
        batas waktu, dan posisi driver terlacak realtime di peta.
      </p>
      <Link
        href="/login"
        className="rounded-lg bg-brand-600 px-5 py-2.5 font-medium text-white hover:bg-brand-700"
      >
        Masuk
      </Link>
    </main>
  );
}
