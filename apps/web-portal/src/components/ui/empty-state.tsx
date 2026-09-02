/**
 * EmptyState — standalone empty-state card for when a section has no data.
 *
 * Extracted from the empty-state branch of ResourceState so pages can render an empty
 * state inline (inside a SectionCard, for example) without pulling in the full
 * loading/error/empty state machine.
 */

interface EmptyStateProps {
  readonly icon: string;
  readonly title: string;
  readonly body: string;
}

export default function EmptyState({ icon, title, body }: EmptyStateProps) {
  return (
    <div className="text-center py-12">
      <span className="material-symbols-outlined text-slate-300 text-5xl">{icon}</span>
      <h3 className="font-bold text-slate-900 mt-3">{title}</h3>
      <p className="text-sm text-slate-500 mt-1">{body}</p>
    </div>
  );
}
