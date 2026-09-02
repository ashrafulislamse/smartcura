'use client';

import { useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import TopBar from '@/components/layout/TopBar';
import ResourceState from '@/components/data/ResourceState';
import { useApiResource } from '@/hooks/use-api-resource';
import { dispatchPharmacyOrder, listPharmacyOrders, shortId } from '@/lib/api/pharmacy';

export default function PharmacyLogistics() {
  const { user, activeMembership, isLoading: authLoading } = useAuth(); const siteId = activeMembership?.site_ids?.[0]; const [working, setWorking] = useState(false); const [message, setMessage] = useState<string | null>(null);
  const { data, isLoading, error, reload } = useApiResource((signal) => listPharmacyOrders({ siteId, status: 'ready_for_dispatch', signal }), [siteId]); const orders = data?.data ?? [];
  async function dispatch(order: (typeof orders)[number]) { setWorking(true); setMessage(null); try { await dispatchPharmacyOrder(order.pharmacy_order_id, order.version, crypto.randomUUID()); setMessage(`Order ${shortId(order.pharmacy_order_id)} dispatched.`); await reload(); } catch (e) { setMessage(e instanceof Error ? e.message : 'Dispatch failed.'); } finally { setWorking(false); } }
  if (authLoading || !user) return <div className="flex items-center justify-center min-h-screen"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-700" /></div>;
  return <main className="flex-1 flex flex-col h-full overflow-hidden bg-slate-50"><TopBar breadcrumbs={[{ label: 'Pharmacy' }, { label: 'Logistics Command Center' }]} /><div className="flex-1 overflow-y-auto p-6"><div className="max-w-5xl mx-auto space-y-6"><header><h1 className="text-3xl font-bold">Dispatch queue</h1><p className="text-slate-500">Dispatch consumes reservations and posts the stock decrement atomically.</p></header><ResourceState isLoading={isLoading} error={error} isEmpty={orders.length === 0} onRetry={reload} loadingLabel="Loading dispatch queue..." errorTitle="Could not load dispatch queue" emptyTitle="No orders ready for dispatch" emptyBody="Orders appear after fulfillment is complete." forbiddenTitle="You cannot view dispatch for this site" emptyIcon="local_shipping" />{message && <div role="status" className="rounded-lg bg-slate-100 p-3 text-sm">{message}</div>}<div className="grid gap-4">{orders.map((order) => <article key={order.pharmacy_order_id} className="bg-white rounded-xl border p-5 flex items-center justify-between gap-4"><div><h2 className="font-bold">Order {shortId(order.pharmacy_order_id)}</h2><p className="text-sm text-slate-500">Patient {shortId(order.patient_profile_id)} · version {order.version}</p></div><button disabled={working} onClick={() => dispatch(order)} className="px-5 py-2 rounded-lg bg-blue-700 text-white disabled:opacity-50">Dispatch</button></article>)}</div></div></div></main>;
}
