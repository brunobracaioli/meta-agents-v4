import { ContentProvider, PageBody } from "@b2tech/lp-render";
import { contentValue } from "@/lib/content";

// The static page is now a thin shell over the shared render package: it feeds the
// build-time content (messages/pt.json + content-spec.json) into <ContentProvider> and
// renders the same <PageBody/> the live web preview uses. See ADR 0017 / SPEC-012.
export default function Page() {
  return (
    <ContentProvider value={contentValue}>
      <PageBody />
    </ContentProvider>
  );
}
