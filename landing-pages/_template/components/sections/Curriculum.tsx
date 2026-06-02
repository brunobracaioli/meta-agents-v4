import { messages } from "@/lib/content";

export function Curriculum() {
  const data = messages.sections.curriculum;
  if (!data) return null;
  return (
    <section className="section">
      <div className="container">
        <h2>{data.heading}</h2>
        <div className="grid">
          {data.modules.map((m, i) => (
            <div className="card" key={i}>
              <span className="eyebrow">Módulo {i + 1}</span>
              <h3>{m.title}</h3>
              <p>{m.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
