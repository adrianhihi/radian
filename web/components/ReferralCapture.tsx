"use client";
import { useEffect } from "react";
import { captureReferrer } from "@/lib/referral";

// Mounted once in the layout: reads ?ref= / /r/<address> and remembers it.
export function ReferralCapture() {
  useEffect(() => captureReferrer(), []);
  return null;
}
