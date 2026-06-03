"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ContentProvider,
  PageBody,
  contentDocToFiles,
  type ContentDoc,
} from "@b2tech/lp-render";

// Client island for the preview. Holds the ContentDoc in state and listens for live
// updates posted by the parent editor (same-origin only), so edits reflect instantly
// without a network round-trip or reload. The theme is injected as a scoped <style> of
// :root token overrides (the serializer's themeCss). Theme values are validated server-side
// (hex colors / font allowlist), so themeCss can never contain markup-breaking sequences.
export function PreviewClient({ initialDoc }: { initialDoc: ContentDoc }) {
  const [doc, setDoc] = useState<ContentDoc>(initialDoc);

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.origin !== window.location.origin) return;
      const data = e.data as { type?: string; doc?: ContentDoc; index?: number } | null;
      if (data?.type === "lp-preview:doc" && data.doc) setDoc(data.doc);
      if (data?.type === "lp-preview:scrollTo" && typeof data.index === "number") {
        // Scroll to the n-th rendered <section> (best-effort: section roots have no stable
        // per-type id, and index matches the enabled, ordered render list for cart-open).
        const sections = document.querySelectorAll("section");
        sections[data.index]?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }
    window.addEventListener("message", onMessage);
    // Announce readiness so the editor pushes the current doc even if it mounted first.
    window.parent?.postMessage({ type: "lp-preview:ready" }, window.location.origin);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const { messages, contentSpec, themeCss } = useMemo(() => contentDocToFiles(doc), [doc]);

  return (
    <>
      {themeCss ? <style>{themeCss}</style> : null}
      <ContentProvider value={{ messages, contentSpec }}>
        <PageBody />
      </ContentProvider>
    </>
  );
}
