'use client';

import ResourceState from './ResourceState';

/** A deliberate state for a capability that has no server endpoint yet. */
export default function UnavailableResource({ label }: { readonly label: string }) {
  return (
    <ResourceState
      isLoading={false}
      error={null}
      isEmpty
      onRetry={() => undefined}
      loadingLabel={`Loading ${label}...`}
      forbiddenTitle={`You cannot view ${label}`}
      errorTitle={`Could not load ${label}`}
      emptyTitle={`${label} unavailable`}
      emptyBody="This portal view is disabled because the API does not expose a collection endpoint for it yet. No demo data is shown."
      emptyIcon="cloud_off"
    />
  );
}
