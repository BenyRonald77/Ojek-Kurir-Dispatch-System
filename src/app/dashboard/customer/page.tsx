"use client";

import { useEffect, useState } from "react";
import OrderMap from "@/components/OrderMap";
import { getSocket } from "@/lib/socket-client";

interface Point {
  lat: number;
  lng: number;
}

interface OrderData {
  id: string;
  status: string;
  pickupLat: number;
  pickupLng: number;
  dropoffLat: number;
  dropoffLng: number;
  assignedDriverId: string | null;
}

const JAKARTA_CENTER = { lat: -6.1754, lng: 106.8272 };

const STATUS_LABEL: Record<string, string> = {
  PENDING: "Mencari driver...",
  OFFERING: "Menawarkan ke driver terdekat...",
  ASSIGNED: "Driver ditugaskan, menuju lokasi jemput",
  PICKED_UP: "Sudah dijemput",
  IN_TRANSIT: "Dalam perjalanan",
  COMPLETED: "Selesai",
  CANCELLED: "Dibatalkan",
  NO_DRIVER_FOUND: "Tidak ada driver tersedia",
};

export default function CustomerDashboardPage() {
  const [pickup, setPickup] = useState<Point | null>(null);
  const [dropoff, setDropoff] = useState<Point | null>(null);
  const [pickMode, setPickMode] = useState<"pickup" | "dropoff">("pickup");
  const [order, setOrder] = useState<OrderData | null>(null);
  const [driverLocation, setDriverLocation] = useState<Point | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/orders")
      .then((r) => r.json())
      .then((data: { orders: OrderData[] }) => {
        const active = data.orders.find((o) =>
          ["PENDING", "OFFERING", "ASSIGNED", "PICKED_UP", "IN_TRANSIT"].includes(o.status)
        );
        if (active) setOrder(active);
      });
  }, []);

  useEffect(() => {
    const socket = getSocket();
    if (order) {
      socket.emit("order:join", { orderId: order.id });
    }

    function handleUpdate(payload: { orderId: string; status: string; assignedDriverId?: string }) {
      setOrder((prev) => {
        if (!prev || prev.id !== payload.orderId) return prev;
        return { ...prev, status: payload.status, assignedDriverId: payload.assignedDriverId ?? prev.assignedDriverId };
      });
    }

    function handleLocation(payload: { orderId: string; lat: number; lng: number }) {
      setOrder((current) => {
        if (current && current.id === payload.orderId) {
          setDriverLocation({ lat: payload.lat, lng: payload.lng });
        }
        return current;
      });
    }

    socket.on("order:update", handleUpdate);
    socket.on("driver:location", handleLocation);
    return () => {
      socket.off("order:update", handleUpdate);
      socket.off("driver:location", handleLocation);
    };
  }, [order?.id]);

  async function handleCreateOrder() {
    if (!pickup || !dropoff) {
      setError("Klik peta untuk menentukan titik jemput dan tujuan terlebih dahulu");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pickupLat: pickup.lat,
          pickupLng: pickup.lng,
          dropoffLat: dropoff.lat,
          dropoffLng: dropoff.lng,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error ?? "Gagal membuat order");
        return;
      }
      setOrder(data.order);
    } finally {
      setCreating(false);
    }
  }

  async function handleCancel() {
    if (!order) return;
    await fetch(`/api/orders/${order.id}/cancel`, { method: "POST" });
    setOrder((prev) => (prev ? { ...prev, status: "CANCELLED" } : prev));
  }

  const isTerminal = order && ["COMPLETED", "CANCELLED", "NO_DRIVER_FOUND"].includes(order.status);

  return (
    <div className="flex flex-1 flex-col gap-4">
      {!order || isTerminal ? (
        <>
          <div className="flex gap-2 rounded-lg border border-slate-300 bg-white p-1 text-sm">
            <button
              onClick={() => setPickMode("pickup")}
              className={`flex-1 rounded-md py-1.5 font-medium ${pickMode === "pickup" ? "bg-brand-600 text-white" : "text-slate-600"}`}
            >
              Set titik jemput {pickup && "✓"}
            </button>
            <button
              onClick={() => setPickMode("dropoff")}
              className={`flex-1 rounded-md py-1.5 font-medium ${pickMode === "dropoff" ? "bg-brand-600 text-white" : "text-slate-600"}`}
            >
              Set tujuan {dropoff && "✓"}
            </button>
          </div>
          <div className="h-80 overflow-hidden rounded-xl border border-slate-200">
            <OrderMap
              center={JAKARTA_CENTER}
              pickup={pickup}
              dropoff={dropoff}
              onMapClick={(point) => (pickMode === "pickup" ? setPickup(point) : setDropoff(point))}
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            onClick={handleCreateOrder}
            disabled={creating}
            className="rounded-lg bg-brand-600 px-4 py-2 font-medium text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {creating ? "Memproses..." : "Buat Order"}
          </button>
        </>
      ) : (
        <>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-sm text-slate-500">Status order</p>
            <p className="text-lg font-semibold text-brand-700">{STATUS_LABEL[order.status] ?? order.status}</p>
            {(order.status === "PENDING" || order.status === "OFFERING") && (
              <button onClick={handleCancel} className="mt-3 text-sm font-medium text-red-600 hover:underline">
                Batalkan order
              </button>
            )}
          </div>
          <div className="h-80 overflow-hidden rounded-xl border border-slate-200">
            <OrderMap
              center={{ lat: order.pickupLat, lng: order.pickupLng }}
              pickup={{ lat: order.pickupLat, lng: order.pickupLng }}
              dropoff={{ lat: order.dropoffLat, lng: order.dropoffLng }}
              driverLocation={driverLocation}
            />
          </div>
        </>
      )}
    </div>
  );
}
