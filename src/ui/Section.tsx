import { useState, type ReactNode } from 'react';

/** Collapsible block with a title row (request details, comparison). */
export function Section({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <section className="section">
      <div className="section-title">
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}>
          <span className="caret">{open ? '▾' : '▸'}</span> {title}
        </button>
        {actions}
      </div>
      {open && <div className="section-body">{children}</div>}
    </section>
  );
}
