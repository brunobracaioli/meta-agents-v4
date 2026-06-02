import { messages } from "@/lib/content";

export function Solution() {
  const data = messages.sections.solution;
  if (!data) return null;
  return (
    <section className="section">
      <div className="container">
        <span className="eyebrow">A solução</span>
        <h2>{data.heading}</h2>
        <p className="lead">{data.body}</p>
      </div>
    </section>
  );
}
