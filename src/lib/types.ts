export const USER_ROLES = ["CUSTOMER", "DRIVER"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const ORDER_STATUSES = [
  "PENDING",
  "OFFERING",
  "ASSIGNED",
  "PICKED_UP",
  "IN_TRANSIT",
  "COMPLETED",
  "CANCELLED",
  "NO_DRIVER_FOUND",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const OFFER_STATUSES = ["PENDING", "ACCEPTED", "REJECTED", "TIMEOUT"] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];
