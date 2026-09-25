# Ojek/Kurir Dispatch System

Sistem dispatch on-demand: pelanggan membuat order, sistem mencari driver
terdekat lewat **Redis GEO**, menawarkan order **secara berurutan dengan
timeout** (bukan broadcast ke semua driver sekaligus), dan melacak posisi
driver **realtime** di peta selama order berjalan — dengan jaminan **satu
order selalu hanya punya satu driver** yang dijamin atomik di database.

## Arsitektur

```
Pelanggan buat order
        │  POST /api/orders
        ▼
dispatchOrder(orderId)  ──►  Redis GEOSEARCH: driver terdekat
        │
        ├─► RESERVASI ATOMIK: UPDATE DriverProfile SET isAvailable=false
        │    WHERE id=driver AND isAvailable=true   (count=0 → lompat ke kandidat berikutnya)
        │
        ├─► kirim tawaran ke driver via Socket.IO room `driver:<id>`
        │
        └─► tunggu respons ATAU timeout 15 detik
             ├─ diterima → order.status = ASSIGNED, SELESAI
             └─ ditolak/timeout → lepas driver, lanjut ke kandidat berikutnya
```

Selama order berjalan, driver mengirim update lokasi lewat Socket.IO;
server memperbarui Redis GEO dan mem-broadcast ke room `order:<id>` yang
diikuti pelanggan, sehingga posisi driver bergerak realtime di peta
(Leaflet + OpenStreetMap) tanpa refresh.

## Kenapa Redis GEO, bukan PostGIS?

Environment development memakai SQLite yang tidak mendukung ekstensi
geospasial. Redis (sudah tersedia di environment ini) menyediakan
`GEOADD`/`GEOSEARCH` bawaan dengan latensi sangat rendah, cocok untuk
pencarian berulang setiap kali order baru masuk atau driver berpindah
posisi. Lihat `src/lib/driver-geo.ts`.

## Jaminan one-order-one-driver

Inti jaminannya ada di `src/lib/dispatch-service.ts`: sebelum menawarkan
order ke seorang driver, sistem melakukan **conditional UPDATE atomik**:

```ts
const reserved = await prisma.driverProfile.updateMany({
  where: { userId: candidate.driverId, isAvailable: true },
  data: { isAvailable: false },
});
if (reserved.count === 0) continue; // sudah direbut dispatch order lain
```

Ini bukan read-then-write terpisah (yang rentan race condition), melainkan
satu operasi atomik di level database. Jika dua proses dispatch (untuk dua
order berbeda) mencoba merebut driver yang sama pada saat bersamaan, hanya
SATU yang berhasil (row count 1); yang lain mendapat `count=0` dan otomatis
lanjut ke kandidat berikutnya.

## Bug non-trivial yang ditemukan & diperbaiki saat verifikasi

**Module duplication antara custom server dan API routes Next.js.**
Percobaan pertama `scripts/verify-sequential-dispatch.ts` gagal total:
driver tidak pernah menerima notifikasi tawaran sama sekali, order selalu
berakhir `NO_DRIVER_FOUND` walau driver online dan dalam radius.

Root cause: `server/index.ts` (dimuat langsung oleh `tsx`) memanggil
`setIO(io)` untuk menyimpan instance Socket.IO server ke sebuah "module
singleton" (`src/lib/socket-registry.ts`, variabel `let ioInstance`). Tapi
saat `POST /api/orders` memicu `dispatchOrder()` → `notifyDriverOffer()`,
kode itu berjalan lewat **route handler yang di-bundle terpisah oleh
Next.js** — yang secara internal memuat ulang seluruh graph modul
(`dispatch-service.ts` → `realtime.ts` → `socket-registry.ts`) sebagai
**instance modul yang berbeda** dari yang dimuat `tsx` di `server/index.ts`.
Akibatnya `getIO()` yang dipanggil dari dalam API route selalu
mengembalikan `null` — instance Socket.IO yang benar tidak pernah terlihat
di sana. Bug yang sama juga mempengaruhi `offer-waiter.ts` (Map penyimpanan
resolver Promise untuk `waitForOfferResponse`), sehingga bahkan jika
notifikasi berhasil dikirim, respons driver tidak akan pernah
"menjangkau" promise yang sedang ditunggu oleh proses dispatch.

**Perbaikan:** memakai pola yang sama dengan singleton Prisma Client
(`globalThis`) alih-alih variabel module-level biasa — karena `globalThis`
benar-benar satu per-proses Node, bukan per-instance-modul:

```ts
const globalForIO = globalThis as unknown as { ioInstance: SocketIOServer | null | undefined };
export function setIO(io: SocketIOServer) { globalForIO.ioInstance = io; }
export function getIO(): SocketIOServer | null { return globalForIO.ioInstance ?? null; }
```

Diterapkan pada `socket-registry.ts` dan `offer-waiter.ts`. Setelah
perbaikan, seluruh skrip verifikasi lolos secara konsisten, di mode
development maupun production.

## Verifikasi (hasil nyata terhadap server yang benar-benar berjalan)

- **`verify-nearest-driver.ts`** — 3 driver didaftarkan ke Redis GEO pada
  jarak berbeda dari titik jemput; urutan hasil `GEOSEARCH` dibandingkan
  dengan perhitungan Haversine manual. Hasil: urutan identik.
- **`verify-sequential-dispatch.ts`** — driver terdekat sengaja tidak
  merespons; memverifikasi order otomatis ditawarkan ke driver berikutnya
  setelah timeout, tercatat di `OrderOffer` (`driver1:TIMEOUT`,
  `driver2:ACCEPTED`).
- **`verify-one-order-one-driver.ts`** — dua order dibuat hampir
  bersamaan dengan satu-satunya driver online yang sama; memverifikasi
  driver hanya PERNAH menerima satu tawaran aktif, order kedua otomatis
  `NO_DRIVER_FOUND` karena driver sudah terpakai.
- **`verify-realtime-tracking.ts`** — driver mengirim 4 update lokasi
  berurutan; memverifikasi pelanggan menerima keempatnya secara realtime,
  berurutan, dan sesuai posisi asli.
- **`verify-production-smoke.ts`** — alur lengkap end-to-end (order →
  tawaran → terima → ASSIGNED) dijalankan terhadap server dalam mode
  `NODE_ENV=production`.

## Menjalankan secara lokal

```bash
cp .env.example .env
npm install

redis-server --daemonize yes   # Redis wajib untuk GEO search

npx prisma db push
npm run prisma:seed             # 1 pelanggan + 3 driver demo

npm run dev                      # custom server (Next.js + Socket.IO) di :3000
```

Login demo: `customer@ojek.dev` (pelanggan), `driver1@ojek.dev` /
`driver2@ojek.dev` / `driver3@ojek.dev` (driver) — password `password123`
untuk semua akun.

### Menjalankan skrip verifikasi

```bash
npm run dev   # di terminal lain
npx tsx scripts/verify-nearest-driver.ts
npx tsx scripts/verify-sequential-dispatch.ts
npx tsx scripts/verify-one-order-one-driver.ts
npx tsx scripts/verify-realtime-tracking.ts
```

Untuk `verify-sequential-dispatch.ts` dan `verify-one-order-one-driver.ts`
yang sengaja mengandalkan timeout, disarankan set sementara
`DISPATCH_OFFER_TIMEOUT_S=5` di `.env` agar pengujian lebih cepat.

## Kenapa custom server, bukan `next dev` biasa?

Socket.IO perlu menempel pada HTTP server yang sama dengan Next.js. Untuk
menghindari isu `AsyncLocalStorage` yang pernah ditemukan di proyek
realtime sebelumnya (import `next/headers` di proses yang dijalankan lewat
`tsx`), logika JWT dipisah ke `src/lib/session-token.ts` (tanpa dependensi
`next/headers`) dan hanya file itu yang diimpor `server/index.ts`.
`src/lib/auth.ts` (yang memakai `next/headers`) hanya dipakai di dalam API
routes/pages Next.js.

## Struktur proyek

```
server/
  index.ts              Custom server: Next.js + Socket.IO + auth handshake
  socket-handlers.ts     Event: order:join, driver:location, offer:respond
src/lib/
  driver-geo.ts           Redis GEO: setDriverLocation, findNearestDrivers
  dispatch-service.ts      Algoritma dispatch sekuensial + jaminan one-order-one-driver
  offer-waiter.ts           Promise-based wait untuk respons driver (globalThis singleton)
  socket-registry.ts        Akses instance Socket.IO dari API routes (globalThis singleton)
  realtime.ts               Helper broadcast (offer baru, update order, lokasi driver)
src/app/
  api/                       REST API (auth, driver status, orders)
  dashboard/customer/         Buat order + peta tracking realtime
  dashboard/driver/            Toggle online, terima/tolak tawaran, update progress
scripts/
  verify-*.ts                 Skrip verifikasi end-to-end terhadap server sungguhan
```

## Di luar cakupan (v1)

- Tarif dinamis, pembayaran, rating.
- Multi-instance Socket.IO (Redis adapter) — v1 satu proses, cukup untuk skala demo.
- Rute jalan sungguhan (routing/ETA) — jarak dihitung garis lurus (Haversine).
