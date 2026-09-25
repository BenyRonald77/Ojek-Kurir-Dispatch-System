type OfferResult = "ACCEPTED" | "REJECTED" | "TIMEOUT" | "CANCELLED";
type Resolver = (result: OfferResult) => void;

// Sama seperti socket-registry.ts: modul ini bisa dimuat sebagai dua instance
// berbeda (server/index.ts via tsx vs API routes via bundel Next.js), jadi
// Map penyimpanan resolver HARUS disimpan di globalThis, bukan sebagai
// variabel module-level biasa, agar benar-benar satu Map yang sama dipakai
// oleh socket handler (yang menerima respons driver) dan dispatch-service
// (yang menunggu respons tersebut).
const globalForOfferWaiter = globalThis as unknown as {
  pendingOfferResolvers: Map<string, Resolver> | undefined;
};

const pendingResolvers = globalForOfferWaiter.pendingOfferResolvers ?? new Map<string, Resolver>();
globalForOfferWaiter.pendingOfferResolvers = pendingResolvers;

export function waitForOfferResponse(offerId: string, timeoutMs: number): Promise<OfferResult> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingResolvers.delete(offerId);
      resolve("TIMEOUT");
    }, timeoutMs);

    pendingResolvers.set(offerId, (result: OfferResult) => {
      clearTimeout(timer);
      pendingResolvers.delete(offerId);
      resolve(result);
    });
  });
}

export function resolveOfferResponse(offerId: string, accepted: boolean) {
  const resolver = pendingResolvers.get(offerId);
  if (resolver) resolver(accepted ? "ACCEPTED" : "REJECTED");
}

export function cancelOfferWait(offerId: string) {
  const resolver = pendingResolvers.get(offerId);
  if (resolver) resolver("CANCELLED");
}
