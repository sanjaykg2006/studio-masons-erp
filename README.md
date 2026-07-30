<div align="center">
  <img src="public/studio-masons-logo.svg" alt="Studio-Masons" width="120" />

  # Studio-Masons ERP

  **A modular, role-based ERP for an interior-design & build firm — from project brief to procurement, inventory, and finance.**

  Built with Next.js 16 (App Router) · React 19 · TypeScript · Supabase (Postgres + RLS) · Tailwind CSS

  ![Next.js](https://img.shields.io/badge/Next.js-16-000000?logo=next.js&logoColor=white)
  ![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
  ![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
  ![Supabase](https://img.shields.io/badge/Supabase-Postgres%20%2B%20RLS-3ECF8E?logo=supabase&logoColor=white)
  ![Tailwind CSS](https://img.shields.io/badge/Tailwind-v4-06B6D4?logo=tailwindcss&logoColor=white)

</div>

---

## Overview

Studio-Masons ERP is a single system where an interior-design and build company runs its
whole operation: creating projects, running the design pipeline, procuring materials from
vendors, tracking inventory and company assets, and managing finance and petty cash — each
as an independent, permission-aware module.

Access is **invite-only** and governed by a **role-based access-control (RBAC)** model that
is enforced not just in the UI but **deep in the database** with Postgres Row-Level Security.
Every person sees and touches only what their role allows.

> **Why it's interesting:** the app is built as a registry of self-contained feature modules.
> Adding a module wires up its own route, sidebar link, permission matrix rows, and database
> security policies — the shell and navigation are generated from data, never hard-coded.

## Screenshots

> _Add your own captures to `docs/screenshots/` and they'll render here._

| Dashboard | Access Control |
|-----------|----------------|
| ![Dashboard](docs/screenshots/dashboard.png) | ![Access Control](docs/screenshots/access.png) |

| Procurement | Project view |
|-------------|--------------|
| ![Procurement](docs/screenshots/procurement.png) | ![Project](docs/screenshots/project.png) |

## Features

Each item below is a live module in the app:

- **Dashboard** — live company overview with KPIs and per-project progress.
- **Projects** — the central workflow; projects, briefs, membership, and per-project roles.
- **Design Department** — project → brief pipeline with versioned templates and sub-teams
  (Concept / Technical) that keep tasks private from each other.
- **Procurement** — Budget BOQ → purchase intent → vendor-rate entry → purchase order →
  goods receipt, with a vendor directory and generated PO documents.
- **Inventory** — per-project material tracking (received / consumed / on-hand) plus a
  company-wide asset registry with two-party asset transfers.
- **Finance** — vendor invoices and payment requests built on top of procurement orders.
- **Petty Cash** — company-wide petty-cash entries and categories.
- **Departments & Team Access** — create departments, assign leads, allot modules, and
  manage each department's people and roles.
- **Access Control** — invite/remove users, assign office job titles, and manage the
  company-wide permission matrix.
- **Activity Log** — a department-wise, paged audit trail of who did what.
- **Error Log** — an admin-only, in-app view of website crashes and backend errors.

### Security & access model

- **Invite-only auth** — no self-signup; Microsoft (Entra) SSO planned.
- **Single role per user**, where a role is a reusable bundle of `(resource, action)` permissions.
- **Three separate access layers**: company/back-office setup → per-department teams →
  per-project roles.
- **Defense in depth**: middleware session guard → server-side page guards → Row-Level
  Security policies in Postgres. Even a request that bypassed the UI is refused by the database.

## Tech Stack

| Layer | Choice |
|-------|--------|
| Framework | Next.js 16 (App Router, Server Actions) |
| UI | React 19, Tailwind CSS v4, shadcn/ui, Radix primitives, lucide icons |
| Language | TypeScript (strict, no `any`) |
| Backend / DB | Supabase — Postgres, Auth, Row-Level Security |
| Validation | Zod |
| Documents | jsPDF, pdf-lib, ExcelJS (PO / report generation) |
| Testing | Vitest |
| Tooling | ESLint, Supabase CLI migrations |
| Hosting | Vercel |

## Architecture

Strict layering — each layer has one job:

```
src/
├── app/            Routing only. (auth) = public, (app) = protected route groups.
├── core/           Cross-cutting infrastructure:
│   ├── supabase/     browser / server / middleware / admin clients
│   ├── auth/         session guards + AuthProvider
│   ├── rbac/         permission types & checks
│   └── modules/      the feature registry + ModuleDefinition contract
├── modules/        Self-contained feature modules (where the ERP grows).
├── components/     ui/ (shadcn primitives) + layout/ (app shell)
└── lib/            generic helpers
```

The sidebar, routes, and permission matrix are all generated from
`src/core/modules/registry.ts`. Adding a feature means: create the module folder, add its
route, and register it — nothing else is hand-wired. See [`docs/architecture.md`](docs/architecture.md)
and [`docs/modules.md`](docs/modules.md).

## Getting Started

### Prerequisites

- Node.js 20+
- A [Supabase](https://supabase.com) project (free tier is fine)

### 1. Install

```bash
git clone https://github.com/sanjaykg2006/studio-masons-erp.git
cd studio-masons-erp
npm install
```

### 2. Configure environment

Copy the template and fill in your Supabase project values:

```bash
cp .env.example .env.local
```

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-public-key
NEXT_PUBLIC_SITE_URL=http://localhost:3000
SUPABASE_SERVICE_ROLE_KEY=your-service-role-secret-key   # server-only, never exposed
```

Find these in your Supabase dashboard under **Project Settings → API**.

### 3. Set up the database

Link the CLI to your project and push the migrations:

```bash
npm run db:link      # supabase link
npm run db:push      # applies supabase/migrations/*
```

### 4. Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Because the app is invite-only, create
your first admin user in the Supabase dashboard (or via the invite flow) to sign in.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start the dev server |
| `npm run build` | Production build |
| `npm run start` | Serve the production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript, no emit |
| `npm run test` | Run the Vitest suite |
| `npm run db:push` | Apply database migrations |
| `npm run db:backup` | Back up the database |

## Documentation

In-depth docs live in [`docs/`](docs/): [architecture](docs/architecture.md),
[authentication](docs/auth.md), [modules](docs/modules.md),
[permissions / RBAC](docs/permissions.md), and [migrations](docs/migrations.md).

---

<div align="center">
  <sub>Built by Sanjay K.</sub>
</div>
