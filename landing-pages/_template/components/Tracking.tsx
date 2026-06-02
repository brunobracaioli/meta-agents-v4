"use client";

import { useEffect, useState } from "react";
import Script from "next/script";
import { contentSpec } from "@/lib/content";
import { captureUtms } from "@/lib/utm";
import { CONSENT_EVENT, getConsent, type ConsentRecord } from "@/lib/consent";

// Injects FB Pixel + GA4 ONLY after consent is granted. Nothing tracking-related is
// present in the initial static HTML. See ADR 0012 / SPEC-011 §6.
export function Tracking() {
  const [granted, setGranted] = useState(false);
  const { fb_pixel_id: fbPixelId, ga4_id: ga4Id } = contentSpec.tracking;

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

  if (!granted) return null;

  return (
    <>
      {fbPixelId ? (
        <Script id="fb-pixel" strategy="afterInteractive">
          {`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
document,'script','https://connect.facebook.net/en_US/fbevents.js');
fbq('init','${fbPixelId}');fbq('track','PageView');`}
        </Script>
      ) : null}

      {ga4Id ? (
        <>
          <Script
            id="ga4-src"
            strategy="afterInteractive"
            src={`https://www.googletagmanager.com/gtag/js?id=${ga4Id}`}
          />
          <Script id="ga4-init" strategy="afterInteractive">
            {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}
gtag('js',new Date());gtag('config','${ga4Id}');`}
          </Script>
        </>
      ) : null}
    </>
  );
}
