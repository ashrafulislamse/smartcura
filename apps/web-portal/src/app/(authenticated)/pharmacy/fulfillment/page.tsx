'use client';

import { useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import TopBar from '@/components/layout/TopBar';
import ResourceState from '@/components/data/ResourceState';
import { useApiResource } from '@/hooks/use-api-resource';
import { listPharmacyOrders, transitionPharmacyOrder, shortId, humaniseCode } from '@/lib/api/pharmacy';

export default function PharmacyFulfillment() {
  const { user, activeMembership, isLoading: authLoading } = useAuth();
  const siteId = activeMembership?.site_ids?.[0]; const [working, setWorking] = useState(false); const [message, setMessage] = useState<string | null>(null);
  const { data, isLoading, error, reload } = useApiResource((signal) => listPharmacyOrders({ siteId, status: 'fulfilling', signal }), [siteId]);
  const orders = data?.data ?? [];
  async function move(order: (typeof orders)[number], status: 'ready_for_dispatch' | 'cancelled') { setWorking(true); setMessage(null); try { await transitionPharmacyOrder(order.pharmacy_order_id, { status, reason_code: status === 'cancelled' ? 'pharmacy_cancelled' : null, expected_version: order.version }); setMessage(`Order ${shortId(order.pharmacy_order_id)} moved to ${humaniseCode(status)}.`); await reload(); } catch (e) { setMessage(e instanceof Error ? e.message : 'Could not update order.'); } finally { setWorking(false); } }
  if (authLoading || !user) return <div className="flex items-center justify-center min-h-screen"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-700" /></div>;
  return <main className="flex-1 flex flex-col h-full overflow-hidden bg-slate-50"><TopBar breadcrumbs={[{ label: 'Pharmacy' }, { label: 'Fulfillment' }]} /><div className="flex-1 overflow-y-auto p-6"><div className="max-w-6xl mx-auto space-y-6"><header><h1 className="text-3xl font-bold">Fulfillment queue</h1><p className="text-slate-500">Complete preparation, then advance only when the order is packed and ready for dispatch.</p></header><ResourceState isLoading={isLoading} error={error} isEmpty={orders.length === 0} onRetry={reload} loadingLabel="Loading fulfillment queue..." errorTitle="Could not load fulfillment queue" emptyTitle="No orders in fulfillment" emptyBody="Validated orders appear after stock reservation." forbiddenTitle="You cannot view fulfillment for this site" emptyIcon="inventory_2" />{message && <div role="status" className="rounded-lg bg-slate-100 p-3 text-sm">{message}</div>}<div className="grid gap-4">{orders.map((order) => <article key={order.pharmacy_order_id} className="bg-white rounded-xl border p-5 flex flex-wrap items-center justify-between gap-4"><div><h2 className="font-bold">Order {shortId(order.pharmacy_order_id)}</h2><p className="text-sm text-slate-500">{order.items.length} item(s) · version {order.version} · patient {shortId(order.patient_profile_id)}</p></div><div className="flex gap-2"><button disabled={working} onClick={() => move(order, 'cancelled')} className="px-3 py-2 border border-red-300 text-red-700 rounded-lg disabled:opacity-50">Cancel</button><button disabled={working} onClick={() => move(order, 'ready_for_dispatch')} className="px-4 py-2 bg-blue-700 text-white rounded-lg disabled:opacity-50">Mark ready for dispatch</button></div></article>)}</div></div></div></main>;
}
