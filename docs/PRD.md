# PRD — Ojek/Kurir Dispatch System

## 1. Latar Belakang

Sistem dispatch untuk layanan ojek/kurir on-demand: pelanggan membuat order
dengan titik jemput & tujuan, sistem mencari driver terdekat yang sedang
online, menawarkan order ke driver tersebut, dan jika driver tidak merespons
dalam waktu tertentu, order ditawarkan ke driver terdekat berikutnya. Lokasi
driver dilacak secara realtime di peta selama order berjalan.

## 2. Tujuan

1. **Cari driver terdekat** dari titik jemput, di antara driver yang sedang
   online & tersedia (tidak sedang mengerjakan order lain).
2. **Penawaran berurutan (sequential offer) dengan timeout**: order
   ditawarkan ke satu driver terdekat pada satu waktu; jika driver tidak
   merespons dalam N detik atau menolak, order otomatis ditawarkan ke driver
   terdekat berikutnya.
3. **Pelacakan lokasi realtime**: pelanggan melihat posisi driver bergerak di
   peta secara langsung selama order berjalan (jemput → antar).
4. **Jaminan satu order = satu driver**: tidak boleh ada dua order aktif
   ditugaskan ke driver yang sama, dan tidak boleh ada driver ditawarkan dua
   order secara bersamaan — dijamin secara atomik di level database, bukan
   hanya asumsi di level aplikasi.

## 3. Solusi Teknis

### 3.1 Pencarian driver terdekat — Redis GEO

Posisi setiap driver yang online disimpan di Redis lewat `GEOADD` pada key
`drivers:geo`. Pencarian driver terdekat dari titik jemput memakai
`GEOSEARCH` (radius pencarian dikonfigurasi, default 5 km) yang mengembalikan
driver terurut dari yang **paling dekat**. Redis GEO dipilih (bukan
PostGIS) karena environment development memakai SQLite yang tidak mendukung
ekstensi geospasial, sementara Redis sudah tersedia dan query GEO-nya O(log
N) dengan latensi sangat rendah — cocok untuk pencarian real-time berulang
kali per order.

### 3.2 Dispatch sekuensial dengan timeout & jaminan one-order-one-driver

Algoritma `dispatchOrder(orderId)`:

```
kandidat = GEOSEARCH drivers:geo dari titik jemput, radius 5km, terurut jarak
untuk setiap kandidat (dari yang terdekat):
    # RESERVASI ATOMIK — inti dari jaminan one-order-one-driver
    hasil = UPDATE DriverProfile SET isAvailable=false
            WHERE id=kandidat.id AND isAvailable=true
    jika hasil.count == 0:
        kandidat sudah direbut proses dispatch order lain -> lanjut ke kandidat berikutnya

    buat OrderOffer(order, kandidat, status=PENDING)
    order.status = OFFERING
    kirim notifikasi realtime ke driver (Socket.IO)
    tunggu respons driver ATAU timeout 15 detik

    jika driver menerima (dan order masih berstatus OFFERING dengan offer ini):
        order.status = ASSIGNED, order.assignedDriverId = kandidat.id
        SELESAI
    jika driver menolak / timeout:
        DriverProfile kandidat -> isAvailable = true  (dilepas kembali)
        OrderOffer.status = REJECTED / TIMEOUT
        lanjut ke kandidat berikutnya

jika semua kandidat habis tanpa ada yang menerima:
    order.status = NO_DRIVER_FOUND
```

**Kenapa ini menjamin one-order-one-driver:** langkah reservasi memakai
`UPDATE ... WHERE isAvailable = true` — sebuah *conditional update* atomik
di database (bukan read-then-write terpisah). Jika dua proses dispatch
(untuk dua order berbeda) mencoba merebut driver yang sama pada saat
bersamaan, hanya satu `UPDATE` yang akan mengenai baris dengan
`isAvailable=true` (row count 1); proses kedua mendapati `count=0` dan tahu
harus melompat ke kandidat berikutnya — tanpa race condition, tanpa
locking eksplisit.

### 3.3 Pelacakan lokasi realtime

Selama order berjalan (`ASSIGNED` → `PICKED_UP` → `IN_TRANSIT`), aplikasi
driver mengirim update lokasi periodik lewat WebSocket (Socket.IO). Server
memperbarui `drivers:geo` di Redis dan mem-broadcast posisi ke *room* Socket
khusus order tersebut (`order:<id>`), sehingga pelanggan yang membuka
halaman tracking order tersebut melihat marker driver bergerak di peta
(Leaflet + OpenStreetMap) tanpa perlu refresh.

### 3.4 State machine order

```
PENDING → OFFERING → ASSIGNED → PICKED_UP → IN_TRANSIT → COMPLETED
                 ↘ NO_DRIVER_FOUND (jika semua kandidat habis)
                                 ↘ CANCELLED (dibatalkan pelanggan, hanya sebelum ASSIGNED)
```

## 4. Model Data (ringkas)

- `User` — pelanggan atau driver (dibedakan lewat relasi `DriverProfile`).
- `DriverProfile` — `userId`, `vehicleType`, `isOnline`, `isAvailable`,
  `lastLat`/`lastLng` (cache posisi terakhir untuk ditampilkan di histori,
  posisi live yang dipakai untuk pencarian tetap di Redis).
- `Order` — `customerId`, `pickupLat/Lng`, `dropoffLat/Lng`, `status`,
  `assignedDriverId`.
- `OrderOffer` — riwayat setiap penawaran per order: `orderId`, `driverId`,
  `status` (PENDING/ACCEPTED/REJECTED/TIMEOUT), `offeredAt`, `respondedAt` —
  ini yang membuktikan urutan penawaran sekuensial benar-benar terjadi
  (dipakai juga untuk audit & debugging).

## 5. Verifikasi yang direncanakan

Skrip di `scripts/` menjalankan skenario nyata (proses Node terpisah yang
terhubung ke server sungguhan), bukan simulasi kode:

- `verify-nearest-driver.ts` — mendaftarkan beberapa driver dengan posisi
  berbeda di Redis GEO, memverifikasi urutan hasil pencarian sesuai jarak
  sebenarnya (dihitung ulang dengan formula Haversine untuk pembanding).
- `verify-sequential-dispatch.ts` — driver terdekat sengaja tidak merespons
  (simulasi timeout), memverifikasi order otomatis ditawarkan ke driver
  berikutnya sesuai urutan jarak, tercatat di `OrderOffer`.
- `verify-one-order-one-driver.ts` — dua order dibuat hampir bersamaan
  dengan driver terdekat yang sama; memverifikasi hanya SATU yang berhasil
  mendapat driver tersebut sebagai kandidat pertama, order lain otomatis
  jatuh ke kandidat berikutnya — tanpa ada driver yang menerima dua
  tawaran aktif sekaligus.
- `verify-realtime-tracking.ts` — simulasi driver mengirim update lokasi
  berkala, memverifikasi klien pelanggan (room order) menerima broadcast
  posisi baru secara realtime.

## 6. Di luar cakupan (v1)

- Perhitungan tarif dinamis (surge pricing), pembayaran, rating.
- Multi-instance server (Redis GEO tetap dipakai, tapi Socket.IO belum
  di-cluster lewat Redis adapter — cukup satu proses untuk skala demo).
- Rute jalan sungguhan (routing/ETA) — jarak dihitung garis lurus
  (Haversine), bukan jarak tempuh jalan.
