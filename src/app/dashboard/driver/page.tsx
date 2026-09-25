"use client";

import { useEffect, useState } from "react";
import { getSocket } from "@/lib/socket-client";

interface OfferPayload {
  offerId: string;
  orderId: string;
  pickupLat: number;
  pickupLng: number;
  dropoffLat: number;
  dropoffLng: number;
  timeoutS: number;
}

interface ActiveOrder {
  id: string;
  status: string;
  pickupLat: number;
  pickupLng: number;
  dropoffLat: number;
  dropoffLng: number;
}

const NEXT_STATUS: Record<string, string> = {
  ASSIGNED: "PICKED_UP",
  PICKED_UP: "IN_TRANSIT",
  IN_TRANSIT: "COMPLETED",
};

const NEXT_LABEL: Record<string, string> = {
  ASSIGNED: "Tandai sudah dijemput",
  PICKED_UP: "Mulai perjalanan",
  IN_TRANSIT: "Selesaikan order",
};

export default function DriverDashboardPage() {
  const [online, setOnline] = useState(false);
  const [lat, setLat] = useState("-6.1754");
  const [lng, setLng] = useState("106.8272");
  const [offer, setOffer] = useState<OfferPayload | null>(null);
  const [countdown, setCountdown] = useState(0);
  const [activeOrder, setActiveOrder] = useState<ActiveOrder | null>(null);

  useEffect(() => {
    fetch("/api/orders")
      .then((r) => r.json())
      .then((data: { orders: ActiveOrder[] }) => {
        const active = data.orders.find((o) => ["ASSIGNED", "PICKED_UP", "IN_TRANSIT"].includes(o.status));
        if (active) setActiveOrder(active);
      });
  }, []);

  useEffect(() => {
    const socket = getSocket();

    function handleOffer(payload: OfferPayload) {
      setOffer(payload);
      setCountdown(payload.timeoutS);
    }

    function handleOrderUpdate(payload: { orderId: string; status: string; assignedDriverId?: string }) {
      setActiveOrder((prev) => {
        if (prev && prev.id === payload.orderId) {
          if (payload.status === "COMPLETED" || payload.status === "CANCELLED") return null;
          return { ...prev, status: payload.status };
        }
        return prev;
      });
    }

    socket.on("offer:new", handleOffer);
    socket.on("order:update", handleOrderUpdate);
    return () => {
      socket.off("offer:new", handleOffer);
      socket.off("order:update", handleOrderUpdate);
    };
  }, []);

  useEffect(() => {
    if (!offer || countdown <= 0) return;
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [offer, countdown]);

  useEffect(() => {
    if (offer && countdown === 0) {
      setOffer(null);
    }
  }, [offer, countdown]);

  async function handleToggleOnline() {
    const nextOnline = !online;
    const response = await fetch("/api/driver/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ online: nextOnline, lat: Number(lat), lng: Number(lng) }),
    });
    if (response.ok) {
      setOnline(nextOnline);
      if (nextOnline) {
        getSocket().emit("driver:location", { lat: Number(lat), lng: Number(lng) });
      }
    }
  }

  function handleSendLocation() {
    getSocket().emit("driver:location", { lat: Number(lat), lng: Number(lng) });
  }

  function handleRespond(accept: boolean) {
    if (!offer) return;
    getSocket().emit("offer:respond", { offerId: offer.offerId, accept });
    if (accept) {
      setActiveOrder({
        id: offer.orderId,
        status: "ASSIGNED",
        pickupLat: offer.pickupLat,
        pickupLng: offer.pickupLng,
        dropoffLat: offer.dropoffLat,
        dropoffLng: offer.dropoffLng,
      });
    }
    setOffer(null);
  }

  async function handleAdvanceStatus() {
    if (!activeOrder) return;
    const nextStatus = NEXT_STATUS[activeOrder.status];
    if (!nextStatus) return;
    const response = await fetch(`/api/orders/${activeOrder.id}/progress`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: nextStatus }),
    });
    if (response.ok) {
      if (nextStatus === "COMPLETED") {
        setActiveOrder(null);
      } else {
        setActiveOrder({ ...activeOrder, status: nextStatus });
      }
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-slate-500">Status driver</p>
            <p className={`text-lg font-semibold ${online ? "text-brand-700" : "text-slate-400"}`}>
              {online ? "Online" : "Offline"}
            </p>
          </div>
          <button
            onClick={handleToggleOnline}
            className={`rounded-lg px-4 py-2 font-medium text-white ${online ? "bg-red-600 hover:bg-red-700" : "bg-brand-600 hover:bg-brand-700"}`}
          >
            {online ? "Offline" : "Online"}
          </button>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-500">Latitude posisi saat ini</label>
            <input
              value={lat}
              onChange={(e) => setLat(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500">Longitude posisi saat ini</label>
            <input
              value={lng}
              onChange={(e) => setLng(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
            />
          </div>
        </div>
        {online && (
          <button
            onClick={handleSendLocation}
            className="mt-3 text-sm font-medium text-brand-600 hover:underline"
          >
            Kirim update lokasi (simulasi bergerak)
          </button>
        )}
      </div>

      {activeOrder && (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-500">Order aktif</p>
          <p className="text-lg font-semibold text-brand-700">{activeOrder.status}</p>
          <p className="mt-1 text-xs text-slate-500">
            Jemput: {activeOrder.pickupLat.toFixed(4)}, {activeOrder.pickupLng.toFixed(4)} → Tujuan:{" "}
            {activeOrder.dropoffLat.toFixed(4)}, {activeOrder.dropoffLng.toFixed(4)}
          </p>
          {NEXT_STATUS[activeOrder.status] && (
            <button
              onClick={handleAdvanceStatus}
              className="mt-3 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
            >
              {NEXT_LABEL[activeOrder.status]}
            </button>
          )}
        </div>
      )}

      {offer && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/40 px-6">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
            <p className="text-sm text-slate-500">Order baru masuk</p>
            <p className="mt-1 text-2xl font-bold text-brand-700">{countdown}s</p>
            <p className="mt-2 text-sm text-slate-600">
              Jemput: {offer.pickupLat.toFixed(4)}, {offer.pickupLng.toFixed(4)}
              <br />
              Tujuan: {offer.dropoffLat.toFixed(4)}, {offer.dropoffLng.toFixed(4)}
            </p>
            <div className="mt-4 flex gap-3">
              <button
                onClick={() => handleRespond(false)}
                className="flex-1 rounded-lg border border-slate-300 py-2 font-medium text-slate-700 hover:bg-slate-50"
              >
                Tolak
              </button>
              <button
                onClick={() => handleRespond(true)}
                className="flex-1 rounded-lg bg-brand-600 py-2 font-medium text-white hover:bg-brand-700"
              >
                Terima
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
