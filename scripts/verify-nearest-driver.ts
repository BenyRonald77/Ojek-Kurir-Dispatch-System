import "dotenv/config";
import { redisConnection } from "../src/lib/redis-connection";
import { setDriverLocation, findNearestDrivers } from "../src/lib/driver-geo";

// Titik jemput: Monas, Jakarta
const PICKUP = { lat: -6.1754, lng: 106.8272 };

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const DRIVERS = [
  { id: "test-driver-far", lat: -6.2, lng: 106.85 }, // ~4.3km
  { id: "test-driver-near", lat: -6.176, lng: 106.828 }, // ~130m
  { id: "test-driver-mid", lat: -6.185, lng: 106.83 }, // ~1.2km
];

async function main() {
  console.log("[verify] Mendaftarkan posisi driver uji ke Redis GEO...");
  for (const d of DRIVERS) {
    await setDriverLocation(d.id, d.lat, d.lng);
  }

  const expectedOrder = [...DRIVERS]
    .map((d) => ({ ...d, expectedDistance: haversineM(PICKUP.lat, PICKUP.lng, d.lat, d.lng) }))
    .sort((a, b) => a.expectedDistance - b.expectedDistance);

  console.log("[verify] Urutan jarak yang diharapkan (Haversine manual):");
  expectedOrder.forEach((d, i) => console.log(`  ${i + 1}. ${d.id} (~${Math.round(d.expectedDistance)}m)`));

  const result = await findNearestDrivers(PICKUP.lat, PICKUP.lng, 10000, []);
  const filtered = result.filter((r) => r.driverId.startsWith("test-driver-"));

  console.log("[verify] Urutan hasil findNearestDrivers (Redis GEOSEARCH):");
  filtered.forEach((d, i) => console.log(`  ${i + 1}. ${d.driverId} (${Math.round(d.distanceM)}m)`));

  const expectedIds = expectedOrder.map((d) => d.id);
  const actualIds = filtered.map((d) => d.driverId);

  if (JSON.stringify(expectedIds) !== JSON.stringify(actualIds)) {
    throw new Error(`GAGAL: urutan tidak sesuai. Diharapkan ${expectedIds}, didapat ${actualIds}`);
  }

  console.log("[verify] BERHASIL: urutan driver terdekat dari Redis GEO sesuai dengan jarak sebenarnya.");

  for (const d of DRIVERS) {
    await redisConnection.zrem("drivers:geo", d.id);
  }
  redisConnection.disconnect();
  process.exit(0);
}

main().catch((error) => {
  console.error("[verify] ERROR:", error);
  process.exit(1);
});
