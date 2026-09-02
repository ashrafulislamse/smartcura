/**
 * PageLoader — centered spinner for auth/loading guards.
 *
 * Replaces the 15 plain `<div>Loading...</div>` text strings across the doctor pages. Uses
 * the same `border-[#1e3fae]` spinner colour as ResourceState so the visual is consistent
 * whether the whole page is loading or just a section.
 */

interface PageLoaderProps {
  readonly label?: string;
}

export default function PageLoader({ label }: PageLoaderProps) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center min-h-screen bg-[#F9FAFB] gap-3">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#1e3fae]"></div>
      {label && <p className="text-sm text-slate-500">{label}</p>}
    </div>
  );
}
