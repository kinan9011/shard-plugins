export interface ToolFaqItem {
  q: string;
  a: string;
}

/** "Help & reference": a collapsed list of questions (styles: .tool-help in index.css). */
export function ToolFaqSection({ items }: { items: ToolFaqItem[] }) {
  if (items.length === 0) return null;
  return (
    <details className="tool-help">
      <summary>Help &amp; reference</summary>
      <div className="tool-help-content">
        {items.map(({ q, a }) => (
          <details key={q} className="tool-help-question">
            <summary>{q}</summary>
            <p>{a}</p>
          </details>
        ))}
      </div>
    </details>
  );
}
