export function CompilationErrors({ title, errors }: { title: string; errors: string[] }) {
  return (
    <div className="banner">
      <details>
        <summary>{title}</summary>
        <pre className="details" tabIndex={0} role="region" aria-label={title}>{errors.join("\n")}</pre>
      </details>
    </div>
  );
}
