# 🏥 SmartCura Web Portal

[![Next.js](https://img.shields.io/badge/Next.js-15-000000?logo=nextdotjs)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-3.4-38B2AC?logo=tailwindcss)](https://tailwindcss.com/)

Next.js 15 admin portal for the SmartCura platform — **68 authenticated
pages, all wired to generated API clients**, plus the 10-page public site in
the same app.

## What it manages

- **Users** — patient and doctor registration, credential verification queue, profiles, bulk operations
- **Appointments** — scheduling, real-time monitoring, consultation history, video oversight
- **Finance** — revenue analytics, transactions, doctor payouts
- **Pharmacy** — orders, fulfillment, stock, delivery coordination
- **Emergency** — SOS monitoring, dispatch, fleet roster, response analytics
- **Support** — tickets, FAQ content, broadcasts, notification inbox
- **Administration** — RBAC roles editor, audit logs, analytics dashboard

Every page renders distinct loading, error, empty and forbidden states — a
permission refusal never looks like an empty table.

## Tech stack

- **Next.js 15** (App Router) + **TypeScript**
- **Tailwind CSS 3.4** + Radix UI (shadcn-style components)
- **Zustand**, **React Hook Form**, **Zod**
- **TanStack Table**, **Recharts**
- API access through **generated OpenAPI clients** via the same-origin `/api/v1/*` proxy

## Getting started

```bash
cp .env.example .env.local
npm install
npm run dev
```

The portal proxies `/api/v1/*` to the API origin configured in `.env.local`,
so the `SameSite=Strict` session cookie always travels on the same origin.

## Public site

The marketing/project site is the `(public)` route group in this app — `/`,
`/how-it-works`, `/apps`, `/ai`, `/security`, `/project`, `/demo` and the
legal pages. It imports nothing from the authenticated tree: by construction
it cannot set the session cookie or call the backend.

## Documentation

- [System architecture](../../docs/ARCHITECTURE.md)
- [Environment variables](../../ENVIRONMENT.md)
- [Roadmap](../../docs/ROADMAP.md)
- [Screen capability matrix](../api/docs/screen-capability-matrix.md)

Synthetic data only — see the medical disclaimer in the
[root README](../../README.md). MIT licensed — see the
[license](../../LICENSE).
