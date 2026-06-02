import { messages } from "@/lib/content";

export function Problem() {
  const data = messages.sections.problem;
  if (!data) return null;
  return (
    <section className="section">
      <div className="container">
        <h2>{data.heading}</h2>
        <p>{data.body}</p>
        {data.bullets ? (
          <ul className="bullets">
            {data.bullets.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}
