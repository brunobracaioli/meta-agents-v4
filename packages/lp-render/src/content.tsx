"use client";

// The runtime content boundary. Both surfaces — the static template (build-time JSON)
// and the live web preview (Supabase-backed ContentDoc) — wrap the page in a
// <ContentProvider>, so the same section components read their copy/spec from context
// instead of a module-level singleton. See ADR 0017 / SPEC-012.

import { createContext, useContext, type ReactNode } from "react";
import type { ContentSpec, Messages } from "./content-types";

export interface ContentValue {
  messages: Messages;
  contentSpec: ContentSpec;
}

/** What useContent() returns: the raw content plus the derived cart-state flag the
 * hero/offer/finalCta sections branch on. */
export interface ResolvedContent extends ContentValue {
  isCartClosed: boolean;
}

const ContentContext = createContext<ContentValue | null>(null);

export function ContentProvider({ value, children }: { value: ContentValue; children: ReactNode }) {
  return <ContentContext.Provider value={value}>{children}</ContentContext.Provider>;
}

export function useContent(): ResolvedContent {
  const ctx = useContext(ContentContext);
  if (!ctx) {
    throw new Error("useContent must be used within a <ContentProvider>");
  }
  return { ...ctx, isCartClosed: ctx.contentSpec.cart_state === "closed" };
}
