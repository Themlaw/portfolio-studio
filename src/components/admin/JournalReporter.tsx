"use client";

import { useEffect } from "react";

import { installGlobalReporters } from "@/lib/journal/browser";

/** Lot 97 : relaie les erreurs JS non rattrapées et les rejets de promesses de l'admin vers le journal (POST /api/log). Ne rend rien. */
export default function JournalReporter() {
  useEffect(() => installGlobalReporters(), []);
  return null;
}
