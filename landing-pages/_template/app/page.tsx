import { contentSpec, isCartClosed, type SectionType } from "@/lib/content";
import { Hero } from "@/components/sections/Hero";
import { Problem } from "@/components/sections/Problem";
import { Solution } from "@/components/sections/Solution";
import { Features } from "@/components/sections/Features";
import { Curriculum } from "@/components/sections/Curriculum";
import { Proof } from "@/components/sections/Proof";
import { Offer } from "@/components/sections/Offer";
import { Faq } from "@/components/sections/Faq";
import { FinalCta } from "@/components/sections/FinalCta";
import { Footer } from "@/components/sections/Footer";

// Composes the page from the section order declared in content-spec.json.
// Unknown ids are skipped. Offer/FinalCta render their waitlist variant when the
// cart is closed (handled inside each component).
const REGISTRY: Record<SectionType, () => React.ReactNode> = {
  hero: () => <Hero key="hero" />,
  problem: () => <Problem key="problem" />,
  solution: () => <Solution key="solution" />,
  features: () => <Features key="features" />,
  curriculum: () => <Curriculum key="curriculum" />,
  proof: () => <Proof key="proof" />,
  offer: () => <Offer key="offer" />,
  faq: () => <Faq key="faq" />,
  finalCta: () => <FinalCta key="finalCta" />,
  footer: () => <Footer key="footer" />,
};

export default function Page() {
  const closed = isCartClosed();
  return (
    <main>
      {contentSpec.sections.map((id) => {
        // When the cart is closed, skip the curriculum/features deep-sell — keep it lean.
        if (closed && (id === "curriculum" || id === "features")) return null;
        const render = REGISTRY[id];
        return render ? render() : null;
      })}
    </main>
  );
}
