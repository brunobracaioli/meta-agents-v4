"use client";

import type { ReactNode } from "react";
import { useContent } from "./content";
import type { SectionType, Tone } from "./content-types";
import { Stage3D } from "./sections/Stage3D";
import { ReviewBridge } from "./sections/ReviewBridge";
import { Hero } from "./sections/Hero";
import { Urgency } from "./sections/Urgency";
import { Problem } from "./sections/Problem";
import { Comparison } from "./sections/Comparison";
import { Solution } from "./sections/Solution";
import { Features } from "./sections/Features";
import { Curriculum } from "./sections/Curriculum";
import { Stats } from "./sections/Stats";
import { Proof } from "./sections/Proof";
import { Logos } from "./sections/Logos";
import { Persona } from "./sections/Persona";
import { Authority } from "./sections/Authority";
import { Offer } from "./sections/Offer";
import { Guarantee } from "./sections/Guarantee";
import { Faq } from "./sections/Faq";
import { FinalCta } from "./sections/FinalCta";
import { Footer } from "./sections/Footer";

// Composes the page from the section order declared in the content spec. Unknown ids
// are skipped. "Flow" sections (light body) alternate white/#F7F9FC striping; fixed-tone
// sections (hero/urgency/stats/authority/offer/finalCta/footer) own their background.
// Offer/FinalCta render their waitlist variant when the cart is closed. See ADR 0013.
// This is the single page body shared by the static template (build) and the live web
// preview (Supabase-backed) — both feed it through a <ContentProvider>. See ADR 0017.
const FLOW_SECTIONS = new Set<SectionType>([
  "problem",
  "comparison",
  "solution",
  "features",
  "curriculum",
  "proof",
  "logos",
  "persona",
  "guarantee",
  "faq",
]);

const REGISTRY: Record<SectionType, (tone: Tone) => ReactNode> = {
  hero: () => <Hero key="hero" />,
  urgency: () => <Urgency key="urgency" />,
  problem: (t) => <Problem key="problem" tone={t} />,
  comparison: (t) => <Comparison key="comparison" tone={t} />,
  solution: (t) => <Solution key="solution" tone={t} />,
  features: (t) => <Features key="features" tone={t} />,
  curriculum: (t) => <Curriculum key="curriculum" tone={t} />,
  stats: () => <Stats key="stats" />,
  proof: (t) => <Proof key="proof" tone={t} />,
  logos: (t) => <Logos key="logos" tone={t} />,
  persona: (t) => <Persona key="persona" tone={t} />,
  authority: () => <Authority key="authority" />,
  offer: () => <Offer key="offer" />,
  guarantee: (t) => <Guarantee key="guarantee" tone={t} />,
  faq: (t) => <Faq key="faq" tone={t} />,
  finalCta: () => <FinalCta key="finalCta" />,
  footer: () => <Footer key="footer" />,
};

export function PageBody() {
  const { contentSpec, isCartClosed: closed } = useContent();
  let flowIndex = 0;
  return (
    <>
      {/* Inert unless loaded with ?review=1 from an allowlisted dashboard: answers the Live
          Review postMessage protocol (scroll + layout). See SPEC-014 / ReviewBridge.tsx. */}
      <ReviewBridge />
      {/* Optional cinematic 3D panel pinned above the hero (renders nothing without a model). */}
      <Stage3D />
      <main>
      {contentSpec.sections.map((id) => {
        // When the cart is closed, skip the curriculum/features deep-sell — keep it lean.
        if (closed && (id === "curriculum" || id === "features")) return null;
        const render = REGISTRY[id];
        if (!render) return null;
        const tone: Tone = FLOW_SECTIONS.has(id) ? (flowIndex++ % 2 === 0 ? "light" : "alt") : "light";
        return render(tone);
      })}
      </main>
    </>
  );
}
