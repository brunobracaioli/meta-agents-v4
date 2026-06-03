import contentSpecJson from "@/content-spec.json";
import messagesJson from "@/messages/pt.json";
import type { ContentSpec, Messages, ContentValue } from "@b2tech/lp-render";

// Typed access to the two content files. `content-spec.json` is the machine spec
// (subdomain, product, price, tracking, section order); `messages/pt.json` is ALL
// human copy (filled by the lp-copywriter subagent). See SPEC-011 §5.
//
// The canonical content TYPES now live in @b2tech/lp-render (shared by the live web
// preview). They are re-exported here so existing template modules keep importing them
// from "@/lib/content" unchanged. See ADR 0017.
export type { SectionType, ContentSpec, CompareCell, Messages, Tone } from "@b2tech/lp-render";

export const contentSpec = contentSpecJson as ContentSpec;
export const messages = messagesJson as Messages;

// The value handed to <ContentProvider> in app/page.tsx: the static build assembles its
// two JSON files into the runtime shape the shared section components consume via
// useContent(). The live web preview builds the same shape from the Supabase ContentDoc.
export const contentValue: ContentValue = { messages, contentSpec };

export function isCartClosed(): boolean {
  return contentSpec.cart_state === "closed";
}
