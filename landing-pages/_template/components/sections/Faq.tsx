import { messages } from "@/lib/content";

export function Faq() {
  if (!messages.faq || messages.faq.length === 0) return null;
  return (
    <section className="section">
      <div className="container">
        <h2>Perguntas frequentes</h2>
        {messages.faq.map((item, i) => (
          <div className="faq-item" key={i}>
            <h3>{item.q}</h3>
            <p>{item.a}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
