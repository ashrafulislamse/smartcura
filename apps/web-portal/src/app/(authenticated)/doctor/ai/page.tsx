'use client';

import Link from 'next/link';
import { useAuth } from '@/hooks/use-auth';
import TopBar from '@/components/layout/TopBar';
import PageLoader from '@/components/ui/page-loader';
import PageHeader from '@/components/ui/page-header';
import SectionCard from '@/components/ui/section-card';

/**
 * Doctor AI landing page — the entry point for the AI surface.
 *
 * The assistant lives at `/doctor/ai/assistant` and the artifacts list at
 * `/doctor/ai/artifacts`. This page links to both so the sidebar's "AI
 * Assistant" group has a natural parent, and a doctor who navigates to
 * `/doctor/ai` sees the options instead of a 404.
 */
export default function DoctorAiLandingPage() {
  const { user, isLoading } = useAuth();

  if (isLoading || !user || user.activeRole !== 'doctor') {
    return <PageLoader label="Loading AI..." />;
  }

  return (
    <main className="flex-1 flex flex-col h-full overflow-hidden bg-[#F9FAFB]">
      <TopBar breadcrumbs={[{ label: 'Doctor' }, { label: 'AI' }]} />
      <div className="flex-1 overflow-y-auto p-6 md:p-8">
        <div className="max-w-[1000px] mx-auto w-full flex flex-col gap-6">
          <PageHeader
            title="Doctor AI"
            subtitle="Governed clinical decision support and AI-generated artifacts for your assigned patients."
          />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Link href="/doctor/ai/assistant" className="group">
              <SectionCard>
                <div className="flex items-start gap-4">
                  <span className="material-symbols-outlined text-[#1e3fae] text-3xl p-2 rounded-lg bg-[#1e3fae]/10">
                    psychology
                  </span>
                  <div>
                    <h2 className="text-lg font-bold text-slate-900 group-hover:text-[#1e3fae] transition-colors">
                      Clinical Assistant
                    </h2>
                    <p className="text-sm text-slate-500 mt-1">
                      Ask a clinical question and receive a synchronous AI
                      decision-support response. Optionally scope the question
                      to an assigned patient.
                    </p>
                    <span className="inline-flex items-center gap-1 mt-3 text-sm font-bold text-[#1e3fae]">
                      Open assistant
                      <span className="material-symbols-outlined text-base group-hover:translate-x-0.5 transition-transform">
                        arrow_forward
                      </span>
                    </span>
                  </div>
                </div>
              </SectionCard>
            </Link>

            <Link href="/doctor/ai/artifacts" className="group">
              <SectionCard>
                <div className="flex items-start gap-4">
                  <span className="material-symbols-outlined text-[#0F766E] text-3xl p-2 rounded-lg bg-[#0F766E]/10">
                    auto_awesome
                  </span>
                  <div>
                    <h2 className="text-lg font-bold text-slate-900 group-hover:text-[#0F766E] transition-colors">
                      AI Artifacts
                    </h2>
                    <p className="text-sm text-slate-500 mt-1">
                      Browse governed AI-generated artifacts across your
                      actively-assigned patients. Filter by type, risk level,
                      and review status.
                    </p>
                    <span className="inline-flex items-center gap-1 mt-3 text-sm font-bold text-[#0F766E]">
                      View artifacts
                      <span className="material-symbols-outlined text-base group-hover:translate-x-0.5 transition-transform">
                        arrow_forward
                      </span>
                    </span>
                  </div>
                </div>
              </SectionCard>
            </Link>
          </div>

          <SectionCard title="Non-diagnostic notice">
            <p className="text-sm text-slate-600">
              All AI output on this surface is <strong>non-diagnostic</strong> and
              intended for clinical decision support only. AI-generated content
              does not constitute a medical diagnosis, treatment recommendation,
              or substitute for professional clinical judgment. Always confirm
              findings with the patient and apply your own clinical reasoning.
            </p>
          </SectionCard>
        </div>
      </div>
    </main>
  );
}
