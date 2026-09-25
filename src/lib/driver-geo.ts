import { redisConnection } from "./redis-connection";

const GEO_KEY = "drivers:geo";

export async function setDriverLocation(driverId: string, lat: number, lng: number) {
  await redisConnection.geoadd(GEO_KEY, lng, lat, driverId);
}

export async function removeDriverLocation(driverId: string) {
  await redisConnection.zrem(GEO_KEY, driverId);
}

export interface NearbyDriver {
  driverId: string;
  distanceM: number;
}

export async function findNearestDrivers(
  lat: number,
  lng: number,
  radiusM: number,
  excludeDriverIds: string[] = []
): Promise<NearbyDriver[]> {
  const raw = (await redisConnection.geosearch(
    GEO_KEY,
    "FROMLONLAT",
    lng,
    lat,
    "BYRADIUS",
    radiusM,
    "m",
    "ASC",
    "WITHCOORD",
    "WITHDIST"
  )) as unknown as [string, string, [string, string]][];

  const excludeSet = new Set(excludeDriverIds);

  return raw
    .map(([driverId, distance]) => ({ driverId, distanceM: Number(distance) }))
    .filter((entry) => !excludeSet.has(entry.driverId));
}
