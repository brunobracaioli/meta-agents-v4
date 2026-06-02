import { messages } from "@/lib/content";

export function Proof() {
  const data = messages.sections.proof;
  if (!data) return null;
  return (
    <section className="section">
      <div className="container">
        <h2>{data.heading}</h2>
        <div className="grid">
          {data.testimonials.map((t, i) => (
            <div className="card" key={i}>
              <p style={{ color: "var(--text)" }}>“{t.quote}”</p>
              <p className="eyebrow" style={{ marginTop: 12 }}>
                {t.author}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
