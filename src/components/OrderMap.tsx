"use client";

import dynamic from "next/dynamic";

const OrderMapInner = dynamic(() => import("./OrderMapInner"), { ssr: false });

export default OrderMapInner;
