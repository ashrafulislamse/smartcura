'use client';

/**
 * Inventory, wired to GET /sites/{site_id}/inventory/batches and /movements.
 *
 * AVAILABLE IS NOT THE SAME AS POSTED, and this page keeps them apart because the schema
 * does. There is no stored quantity column anywhere in inventory: available stock is the
 * projection `posted movements − active reservations`, which is what makes overselling
 * impossible. So a batch showing 100 posted and 40 reserved has 60 available, and a
 * dispenser who reads only the posted figure will promise stock that is already committed.
 * All three numbers are shown, with reserved highlighted when it is non-zero.
 *
 * EXPIRY IS THE OTHER THING THAT MATTERS. FEFO picking drains the earliest-expiring batch
 * first, so batches are ordered by expiry and anything expired or expiring within 30 days is
 * flagged — an expired batch still holding available stock is a dispensing hazard, not a
 * housekeeping note.
 */

import { useMemo, useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useApiResource } from '@/hooks/use-api-resource';
import ResourceState from '@/components/data/ResourceState';
import {
  daysUntil,
  formatInstant,
  humaniseCode,
  listInventoryBatches,
  listStockMovements,
  readInventoryAvailability,
  shortId,
} from '@/lib/api/pharmacy';
import { ApiError } from '@/lib/api/client';
import type { InventoryAvailability } from '@/types/contracts';
import TopBar from '@/components/layout/TopBar';

const EXPIRY_WARNING_DAYS = 30;

export default function InventoryPage() {
  const { user, activeMembership, isLoading: isAuthLoading } = useAuth();
  const [view, setView] = useState<'batches' | 'movements'>('batches');

  const siteId = activeMembership?.site_ids?.[0];

  // Derived availability check: a read of one variant's per-batch availability.
  // The endpoint requires a variant_id, so this is a manual fetch, not useApiResource.
  const [availabilityQuery, setAvailabilityQuery] = useState('');
  const [availability, setAvailability] = useState<InventoryAvailability | null>(null);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [availabilityError, setAvailabilityError] = useState<ApiError | null>(null);

  async function handleCheckAvailability() {
    if (!siteId) return;
    const variantId = availabilityQuery.trim();
    if (variantId === '') return;
    setAvailabilityLoading(true);
    setAvailabilityError(null);
    try {
      const result = await readInventoryAvailability(siteId, variantId);
      setAvailability(result);
    } catch (caught) {
      setAvailability(null);
      setAvailabilityError(
        caught instanceof ApiError
          ? caught
          : new ApiError({
              status: 0,
              code: 'CLIENT_ERROR',
              title: 'Unexpected client error',
              detail: caught instanceof Error ? caught.message : String(caught),
            }),
      );
    } finally {
      setAvailabilityLoading(false);
    }
  }

  const batches = useApiResource(
    (signal) => (siteId ? listInventoryBatches(siteId, { signal }) : Promise.resolve(null)),
    [siteId],
  );
  const movements = useApiResource(
    (signal) => (siteId ? listStockMovements(siteId, { signal }) : Promise.resolve(null)),
    [siteId],
  );

  const rows = useMemo(() => {
    const list = [...(batches.data?.data ?? [])];
    // FEFO order: earliest expiry first, which is the order stock is actually picked in.
    list.sort((a, b) => a.expires_on.localeCompare(b.expires_on));
    return list;
  }, [batches.data]);

  const totals = useMemo(
    () =>
      rows.reduce(
        (accumulator, batch) => ({
          posted: accumulator.posted + batch.posted_quantity,
          reserved: accumulator.reserved + batch.reserved_quantity,
          available: accumulator.available + batch.available_quantity,
        }),
        { posted: 0, reserved: 0, available: 0 },
      ),
    [rows],
  );

  /** Expired batches that still hold available stock: a dispensing hazard. */
  const expiredWithStock = useMemo(
    () =>
      rows.filter((batch) => {
        const days = daysUntil(batch.expires_on);
        return days !== null && days < 0 && batch.available_quantity > 0;
      }).length,
    [rows],
  );
  const expiringSoon = useMemo(
    () =>
      rows.filter((batch) => {
        const days = daysUntil(batch.expires_on);
        return days !== null && days >= 0 && days <= EXPIRY_WARNING_DAYS;
      }).length,
    [rows],
  );

  if (isAuthLoading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#F9FAFB]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#1e3fae]"></div>
      </div>
    );
  }

  const active = view === 'batches' ? batches : movements;
  const movementRows = movements.data?.data ?? [];

  return (
    <main className="flex-1 flex flex-col h-full overflow-hidden relative bg-[#F9FAFB]">
      <TopBar breadcrumbs={[{ label: 'Pharmacy' }, { label: 'Inventory' }]} />

      <div className="flex-1 overflow-y-auto p-8 scroll-smooth">
        <div className="max-w-[1200px] mx-auto flex flex-col gap-6">
          <div>
            <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Inventory</h1>
            <p className="text-slate-500 mt-1">
              Available stock is posted movements minus active reservations. No quantity is stored,
              so these figures cannot drift from the ledger.
            </p>
          </div>

          {!siteId && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" role="status">
              <span className="font-bold">No pharmacy site is assigned to your membership.</span>{' '}
              Inventory is site-scoped, so an administrator must assign you to a site first.
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {[
              { icon: 'inventory', tint: 'text-blue-600', label: 'Posted', value: String(totals.posted), note: 'All ledger movements' },
              { icon: 'lock', tint: 'text-purple-600', label: 'Reserved', value: String(totals.reserved), note: 'Held for open orders' },
              { icon: 'check_circle', tint: 'text-green-600', label: 'Available', value: String(totals.available), note: 'Posted minus reserved' },
              { icon: 'event_busy', tint: 'text-amber-600', label: 'Expiring ≤30d', value: String(expiringSoon), note: 'Batches near expiry' },
            ].map((card) => (
              <div key={card.label} className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <span className={`material-symbols-outlined ${card.tint} text-2xl`}>{card.icon}</span>
                  <span className="text-xs font-bold text-slate-500">{card.label}</span>
                </div>
                <p className="text-2xl font-bold text-slate-900">{batches.isLoading ? '—' : card.value}</p>
                <p className="text-xs text-slate-500 mt-1">{card.note}</p>
              </div>
            ))}
          </div>

          {expiredWithStock > 0 && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900" role="alert">
              <span className="font-bold">
                {expiredWithStock} expired batch{expiredWithStock === 1 ? '' : 'es'} still hold
                available stock.
              </span>{' '}
              FEFO picking will reach these first. Quarantine them before dispensing.
            </div>
          )}

          {/* Derived availability check for one variant. */}
          <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
            <div className="flex items-center gap-2 mb-1">
              <span className="material-symbols-outlined text-[#1e3fae] text-xl">search_check</span>
              <h2 className="font-bold text-slate-900">Check availability</h2>
            </div>
            <p className="text-sm text-slate-500 mb-4">
              Per-batch derived availability for a single variant. Available stock is posted
              movements minus active reservations.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleCheckAvailability();
              }}
              className="flex gap-2"
            >
              <input
                value={availabilityQuery}
                onChange={(e) => setAvailabilityQuery(e.target.value)}
                placeholder="Variant id (UUID)"
                className="flex-1 rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-mono"
              />
              <button
                type="submit"
                disabled={!siteId || availabilityLoading || availabilityQuery.trim() === ''}
                className="px-4 py-2.5 rounded-lg bg-[#1e3fae] text-sm font-bold text-white hover:bg-[#1a3694] disabled:opacity-50"
              >
                {availabilityLoading ? 'Checking…' : 'Check'}
              </button>
            </form>

            {availabilityError && (
              <div
                className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4"
                role="alert"
              >
                <p className="text-sm font-bold text-red-700">
                  {availabilityError.isForbidden
                    ? 'Permission denied'
                    : availabilityError.title}
                </p>
                <p className="text-xs text-red-600 mt-1">{availabilityError.message}</p>
              </div>
            )}

            {availability && (
              <div className="mt-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm text-slate-600">
                    Variant{' '}
                    <code className="text-xs bg-slate-50 px-1.5 py-0.5 rounded">
                      {shortId(availability.variant_id)}
                    </code>
                  </p>
                  <span className="text-sm font-bold text-slate-900">
                    Total available: {availability.total_available_quantity}
                  </span>
                </div>
                {availability.data.length === 0 ? (
                  <p className="text-sm text-slate-500 py-4 text-center">
                    No batches hold stock for this variant.
                  </p>
                ) : (
                  <div className="overflow-x-auto rounded-lg border border-slate-200">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                        <tr>
                          <th className="p-3">Batch</th>
                          <th className="p-3">Expires</th>
                          <th className="p-3 text-right">Posted</th>
                          <th className="p-3 text-right">Reserved</th>
                          <th className="p-3 text-right">Available</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {availability.data.map((batch) => {
                          const days = daysUntil(batch.expires_on);
                          const expired = days !== null && days < 0;
                          const soon =
                            days !== null && days >= 0 && days <= EXPIRY_WARNING_DAYS;
                          return (
                            <tr
                              key={batch.batch_id}
                              className={expired ? 'bg-red-50/40' : soon ? 'bg-amber-50/30' : ''}
                            >
                              <td className="p-3">
                                <code className="text-xs text-slate-700">
                                  {shortId(batch.batch_id)}
                                </code>
                              </td>
                              <td className="p-3">
                                <span
                                  className={
                                    expired
                                      ? 'font-bold text-red-700'
                                      : soon
                                        ? 'font-bold text-amber-700'
                                        : 'text-slate-600'
                                  }
                                >
                                  {batch.expires_on}
                                </span>
                              </td>
                              <td className="p-3 text-right text-slate-600">
                                {batch.posted_quantity}
                              </td>
                              <td className="p-3 text-right">
                                <span
                                  className={
                                    batch.reserved_quantity > 0
                                      ? 'font-bold text-purple-700'
                                      : 'text-slate-400'
                                  }
                                >
                                  {batch.reserved_quantity}
                                </span>
                              </td>
                              <td className="p-3 text-right font-bold text-slate-900">
                                {batch.available_quantity}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </section>

          <div className="flex gap-2">
            {(['batches', 'movements'] as const).map((option) => (
              <button
                key={option}
                onClick={() => setView(option)}
                className={`px-4 py-2 rounded-lg text-sm font-bold border transition-colors ${
                  view === option
                    ? 'bg-[#1e3fae] text-white border-[#1e3fae]'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
              >
                {option === 'batches' ? 'Batches' : 'Stock ledger'}
              </button>
            ))}
          </div>

          <ResourceState
            isLoading={active.isLoading}
            error={active.error}
            isEmpty={view === 'batches' ? rows.length === 0 : movementRows.length === 0}
            onRetry={active.reload}
            loadingLabel={view === 'batches' ? 'Loading batches…' : 'Loading stock ledger…'}
            forbiddenTitle="You cannot view inventory for this site"
            errorTitle="Could not load inventory"
            emptyTitle={view === 'batches' ? 'No batches at this site' : 'No stock movements yet'}
            emptyBody={
              view === 'batches'
                ? 'Batches appear once goods have been received for this site.'
                : 'The ledger records every receipt, reservation and dispatch.'
            }
            emptyIcon="inventory"
          />

          {view === 'batches' && !active.isLoading && !active.error && rows.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <caption className="sr-only">Inventory batches in FEFO order</caption>
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr className="text-left text-xs font-bold text-slate-500 uppercase tracking-wide">
                    <th scope="col" className="px-5 py-3">Batch</th>
                    <th scope="col" className="px-5 py-3">Expires</th>
                    <th scope="col" className="px-5 py-3">Status</th>
                    <th scope="col" className="px-5 py-3 text-right">Posted</th>
                    <th scope="col" className="px-5 py-3 text-right">Reserved</th>
                    <th scope="col" className="px-5 py-3 text-right">Available</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((batch) => {
                    const days = daysUntil(batch.expires_on);
                    const expired = days !== null && days < 0;
                    const soon = days !== null && days >= 0 && days <= EXPIRY_WARNING_DAYS;
                    return (
                      <tr
                        key={batch.batch_id}
                        className={expired ? 'bg-red-50/40' : soon ? 'bg-amber-50/30' : ''}
                      >
                        <td className="px-5 py-3">
                          <span className="font-mono text-xs text-slate-700">{batch.lot_number}</span>
                          <span className="block text-xs text-slate-400">
                            variant {shortId(batch.variant_id)}
                          </span>
                        </td>
                        <td className="px-5 py-3">
                          <span className={expired ? 'font-bold text-red-700' : soon ? 'font-bold text-amber-700' : 'text-slate-600'}>
                            {batch.expires_on}
                          </span>
                          {days !== null && (
                            <span className="block text-xs text-slate-400">
                              {expired ? `${Math.abs(days)}d ago` : `in ${days}d`}
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-slate-600">{humaniseCode(batch.status)}</td>
                        <td className="px-5 py-3 text-right text-slate-600">{batch.posted_quantity}</td>
                        <td className="px-5 py-3 text-right">
                          <span className={batch.reserved_quantity > 0 ? 'font-bold text-purple-700' : 'text-slate-400'}>
                            {batch.reserved_quantity}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-right font-bold text-slate-900">
                          {batch.available_quantity}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {view === 'movements' && !active.isLoading && !active.error && movementRows.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <caption className="sr-only">Append-only stock ledger movements</caption>
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr className="text-left text-xs font-bold text-slate-500 uppercase tracking-wide">
                    <th scope="col" className="px-5 py-3">Movement</th>
                    <th scope="col" className="px-5 py-3">Type</th>
                    <th scope="col" className="px-5 py-3">Reference</th>
                    <th scope="col" className="px-5 py-3">Occurred</th>
                    <th scope="col" className="px-5 py-3 text-right">Delta</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {movementRows.map((movement) => (
                    <tr key={movement.movement_id}>
                      <td className="px-5 py-3">
                        <code className="text-xs text-slate-700">{shortId(movement.movement_id)}</code>
                        <span className="block text-xs text-slate-400">
                          batch {shortId(movement.batch_id)}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-slate-600">{humaniseCode(movement.movement_type)}</td>
                      <td className="px-5 py-3 text-slate-600">
                        {humaniseCode(movement.reference_type)}
                        {movement.reason_code && (
                          <span className="block text-xs text-slate-400">{movement.reason_code}</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-slate-500">{formatInstant(movement.occurred_at)}</td>
                      <td className="px-5 py-3 text-right">
                        {/* Signed on purpose: a receipt and a dispatch are not interchangeable. */}
                        <span
                          className={
                            movement.quantity_delta < 0 ? 'font-bold text-red-700' : 'font-bold text-green-700'
                          }
                        >
                          {movement.quantity_delta > 0 ? '+' : ''}
                          {movement.quantity_delta}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
