"use client";

import { useEffect, useState } from "react";
import { getConsent, setConsent } from "@/lib/consent";

// LGPD consent banner. Shown until the user accepts or rejects. On accept it writes
// localStorage["b2tech_consent_v1"] and dispatches the consent event that <Tracking/>
// listens for. See SPEC-011 §6.
export function Consent() {
  const [decided, setDecided] = useState(true);

  useEffect(() => {
    setDecided(getConsent() !== null);
  }, []);

  if (decided) return null;

  return (
    <div className="consent" role="dialog" aria-live="polite" aria-label="Consentimento de cookies">
      <p>
        Usamos cookies para medir e melhorar sua experiência. Você pode aceitar ou recusar o
        rastreamento (Pixel e GA4).
      </p>
      <div className="consent-actions">
        <button
          type="button"
          className="btn-ghost"
          onClick={() => {
            setConsent(false);
            setDecided(true);
          }}
        >
          Recusar
        </button>
        <button
          type="button"
          className="btn-accept"
          onClick={() => {
            setConsent(true);
            setDecided(true);
          }}
        >
          Aceitar
        </button>
      </div>
    </div>
  );
}
