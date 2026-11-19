import type { ReactNode } from "react";

export function CompilationErrors({ title, errors, action }: { title: string; errors: string[]; action?: ReactNode }) {
  return (
    <div className={action ? "banner banner-with-action" : "banner"}>
      <details>
        <summary>{title}</summary>
        <pre className="details" tabIndex={0} role="region" aria-label={title}>{errors.join("\n")}</pre>
      </details>
      {action}
    </div>
  );
}
