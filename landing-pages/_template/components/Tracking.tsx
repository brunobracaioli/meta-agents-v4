"use client";

import { useEffect, useState } from "react";
import Script from "next/script";
import { contentSpec } from "@/lib/content";
import { captureUtms } from "@b2tech/lp-render";
import { CONSENT_EVENT, getConsent, type ConsentRecord } from "@/lib/consent";
import { initEventTracking, resolveTrackingIds } from "@/lib/track";

// Injects FB Pixel(s) + GA4 + Google Ads ONLY after consent is granted. Nothing
// tracking-related is present in the initial static HTML. A page may carry MORE THAN ONE
// of each ID (settings.tracking.{meta_pixels,ga4_ids,google_ads_ids}); the legacy single
// fb_pixel_id/ga4_id are honored as a fallback. See ADR 0012 / 0021 / SPEC-011 §6 / SPEC-015.
export function Tracking() {
  const [granted, setGranted] = useState(false);
  const { metaPixels, ga4Ids, googleAdsIds } = resolveTrackingIds(contentSpec.tracking);
  // gtag.js (one script) covers BOTH GA4 and Google Ads; load it if either is present, using
  // the first available id as the bootstrap target. Each id is then configured individually.
  const gtagIds = [...ga4Ids, ...googleAdsIds];

  useEffect(() => {
    captureUtms();
    setGranted(getConsent()?.granted === true);
    const onConsent = (e: Event) => {
      const detail = (e as CustomEvent<ConsentRecord>).detail;
      setGranted(detail?.granted === true);
    };
    window.addEventListener(CONSENT_EVENT, onConsent);
    return () => window.removeEventListener(CONSENT_EVENT, onConsent);
  }, []);

  // Event instrumentation (ViewContent, scroll-depth, checkout/waitlist clicks) — attaches
  // only after consent and tears down on revoke. Safe before the tags finish loading: the
  // fbq/gtag stubs queue calls. See lib/track.ts for the event taxonomy (SPEC-015 §4).
  useEffect(() => {
    if (!granted) return;
    return initEventTracking(contentSpec, { googleAdsIds });
  }, [granted, googleAdsIds]);

  if (!granted) return null;

  return (
    <>
      {metaPixels.length > 0 ? (
        <Script id="fb-pixel" strategy="afterInteractive">
          {`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
document,'script','https://connect.facebook.net/en_US/fbevents.js');
${metaPixels.map((id) => `fbq('init','${id}');`).join("\n")}
fbq('track','PageView');`}
        </Script>
      ) : null}

      {gtagIds.length > 0 ? (
        <>
          <Script
            id="gtag-src"
            strategy="afterInteractive"
            src={`https://www.googletagmanager.com/gtag/js?id=${gtagIds[0]}`}
          />
          <Script id="gtag-init" strategy="afterInteractive">
            {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}
gtag('js',new Date());
${gtagIds.map((id) => `gtag('config','${id}');`).join("\n")}`}
          </Script>
        </>
      ) : null}
    </>
  );
}
