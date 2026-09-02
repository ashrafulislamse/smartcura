'use client';

import { useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import TopBar from '@/components/layout/TopBar';
import ResourceState from '@/components/data/ResourceState';
import { useApiResource } from '@/hooks/use-api-resource';
import { listPharmacyOrders, validatePharmacyOrder, humaniseCode, shortId } from '@/lib/api/pharmacy';

export default function PharmacyValidation() {
  const { user, activeMembership, isLoading: authLoading } = useAuth();
  const siteId = activeMembership?.site_ids?.[0];
  const [selected, setSelected] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const { data, isLoading, error, reload } = useApiResource(
    (signal) => listPharmacyOrders({ siteId, status: 'awaiting_validation', signal }), [siteId],
  );
  const orders = data?.data ?? [];
  const active = orders.find((o) => o.pharmacy_order_id === selected) ?? orders[0];
  async function decide(state: 'valid' | 'invalid' | 'needs_clarification') {
    if (!active) return;
    setWorking(true); setMessage(null);
    try {
      await validatePharmacyOrder(active.pharmacy_order_id, { state, reason_code: state === 'valid' ? null : state, expected_version: active.version }, crypto.randomUUID());
      setMessage(`Order ${shortId(active.pharmacy_order_id)} is ${humaniseCode(state)}.`); await reload();
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Validation failed.'); }
    finally { setWorking(false); }
  }
  if (authLoading || !user) return <div className="flex items-center justify-center min-h-screen"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-700" /></div>;
  return <main className="flex-1 flex flex-col h-full overflow-hidden bg-slate-50"><TopBar breadcrumbs={[{ label: 'Pharmacy' }, { label: 'Validation Hub' }]} /><div className="flex-1 overflow-y-auto p-6"><div className="max-w-6xl mx-auto space-y-6"><header><h1 className="text-3xl font-bold text-slate-900">Prescription validation</h1><p className="text-slate-500">Review orders awaiting validation; a valid decision reserves stock by FEFO.</p></header>{!siteId && <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">No pharmacy site is assigned to your membership.</div>}<ResourceState isLoading={isLoading} error={error} isEmpty={orders.length === 0} onRetry={reload} loadingLabel="Loading validation queue..." errorTitle="Could not load validation queue" emptyTitle="No orders awaiting validation" emptyBody="New signed prescriptions appear here." forbiddenTitle="You cannot view validation for this site" emptyIcon="fact_check" />{orders.length > 0 && <div className="grid md:grid-cols-[320px_1fr] gap-6"><div className="bg-white rounded-xl border divide-y">{orders.map((order) => <button key={order.pharmacy_order_id} onClick={() => setSelected(order.pharmacy_order_id)} className={`block w-full text-left p-4 ${active?.pharmacy_order_id === order.pharmacy_order_id ? 'bg-blue-50 border-l-4 border-blue-700' : ''}`}><span className="font-mono text-sm">{shortId(order.pharmacy_order_id)}</span><span className="block text-xs text-slate-500">Prescription {shortId(order.prescription_id)} · v{order.version}</span></button>)}</div><section className="bg-white rounded-xl border p-6 space-y-5"><h2 className="text-xl font-bold">Order {shortId(active?.pharmacy_order_id ?? null)}</h2><p className="text-sm text-slate-600">Patient identifier: {shortId(active?.patient_profile_id ?? null)}</p><p className="text-sm text-slate-600">{active?.items.length ?? 0} medication item(s) · received {active ? new Date(active.created_at).toLocaleString() : '—'}</p>{message && <div role="status" className="rounded-lg bg-slate-100 p-3 text-sm">{message}</div>}<div className="flex flex-wrap gap-3"><button disabled={working} onClick={() => decide('needs_clarification')} className="px-4 py-2 rounded-lg border border-amber-300 text-amber-700 disabled:opacity-50">Need clarification</button><button disabled={working} onClick={() => decide('invalid')} className="px-4 py-2 rounded-lg border border-red-300 text-red-700 disabled:opacity-50">Reject</button><button disabled={working} onClick={() => decide('valid')} className="px-5 py-2 rounded-lg bg-blue-700 text-white disabled:opacity-50">Approve & reserve stock</button></div></section></div>}</div></div></main>;
}
