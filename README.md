# spindle

A composable TypeScript application framework for Cloudflare Workers, built on **Hono** with server-side JSX (`hono/jsx`). MVC architecture organized into three branches — **fiber** (data), **thread** (domain), and **fabric** (design) — shipped as the `spindle` npm package.

This repository is a workspace containing the framework (`packages/`) and an example application (`examples/tenet`).

---

## Workspace layout

```
├── packages/              # the `spindle` framework (npm package)
│   ├── fiber/             # data layer — schema, seed, stored-query DSL + generation
│   ├── thread/            # app layer — controllers, repositories, services, guards, errors
│   ├── fabric/            # client layer — handlers, CSS build, hydration
│   ├── plugins/           # Vite plugin entry points
│   └── index.ts           # unified entry re-exporting all branches
├── examples/
│   └── tenet/             # example app — Cloudflare Worker with D1
└── package.json           # workspace root
```

## Getting started

From the workspace root:

```bash
npm install
```

### Build the framework

```bash
npm run build --workspace spindle
```

### Run the example app

```bash
npm run dev --workspace tenet
```

```bash
npm run deploy --workspace tenet
```

The example also has `build`, `preview`, `test`, `check:type`, and `cf-typegen` scripts — all runnable with `--workspace tenet` or from inside `examples/tenet/`.

---

## Importing the framework

Consumers depend on the `spindle` package and import from its subpath exports:

| Import | What it provides |
|---|---|
| `spindle` | Everything (root re-export) |
| `spindle/fiber` | Schema/seed/procs DSL, `applySchema`, `applySeed`, `Database` types |
| `spindle/thread` | `ControllerBase`, `RepositoryBase`, `ServiceBase`, guards, errors, middleware |
| `spindle/fabric` | `useHandler`, `BaseHandler`, `hydrate`/`hydrateEvent`, CSS build |
| `spindle/plugins` | Vite plugins — `spindlePlugin`, `fiberPlugin`, `fabricPlugin`, `threadPlugin` |

```ts
import { ControllerBase, Get } from "spindle/thread";
import { defineSchema, table, col } from "spindle/fiber";
import { useHandler } from "spindle/fabric";
import { spindlePlugin } from "spindle/plugins";
```

---

## Architecture

The project uses a two-layer structure:

- **`packages/`** — Framework code (the `spindle` package). Contains `ControllerBase`, `RepositoryBase`, `ServiceBase`, `BaseHandler`, validation, error classes, and Vite plugins.
- **`examples/tenet/`** — Application code. Contains controllers, views, services, repositories, and project-specific error handling, all imported from `spindle/*`.

Controllers import from `spindle/thread` and call `configureRendering()` to wire up the shared layout and error handler.

### The three branches

| Branch | Concern | Provides |
|---|---|---|
| **fiber** | Data | SQL, schemas, seeds, stored queries (`procs.ts`), database adapters, type generation |
| **thread** | Domain | Controllers, repositories, services, guards, validation, errors |
| **fabric** | Design | Components, views, layouts, client handlers, CSS |

See [`packages/README.md`](packages/README.md) for the full framework documentation and [`METAPHOR.md`](METAPHOR.md) for the conceptual model behind the three branches.

---

## Build process

The framework is built with **tsdown** (`packages/`), emitting `dist/` per entry.

The example app's build is driven by Vite plugins from `spindle/plugins`, one per branch plus a unified entry:

| Plugin | Purpose |
|---|---|
| `spindlePlugin` | Unified entry — runs all three branches from one options object |
| `fiberPlugin` | Generates db-types, derived `schema.sql`, the runtime schema module, the compiled seed module, and typed `procs.generated.ts` modules |
| `fabricPlugin` | Combines, scopes, inlines SVGs, minifies CSS; auto-registers client handlers |
| `threadPlugin` | Bundles client-side TypeScript via esbuild |

All plugins are configured in `examples/tenet/vite.config.ts` and run automatically during `npm run dev` and `npm run build`.

---

## License

MIT