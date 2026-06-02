import { messages } from "@/lib/content";

export function Features() {
  const data = messages.sections.features;
  if (!data) return null;
  return (
    <section className="section">
      <div className="container">
        <h2>{data.heading}</h2>
        <div className="grid">
          {data.items.map((item, i) => (
            <div className="card" key={i}>
              <h3>{item.title}</h3>
              <p>{item.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
