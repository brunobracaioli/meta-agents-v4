import { messages } from "@/lib/content";

export function Footer() {
  return (
    <footer>
      <div className="container">
        {messages.footer.links.map((l, i) => (
          <a key={i} href={l.href}>
            {l.label}
          </a>
        ))}
        <p style={{ marginTop: 16 }}>{messages.footer.legal}</p>
      </div>
    </footer>
  );
}
