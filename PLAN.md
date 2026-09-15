# Tenet — Implementation Plan

## Overview

A private, single-team decision journal. Members propose structured tenets (context + options + recommendation), vote using consent-based voting (approve/abstain/block), and the outcome is permanently recorded. The archive becomes the team's institutional memory.

Built on the existing spindlework framework with D1 for storage and GitHub OAuth for authentication.

---

## 1. Data Model (D1)

### `users`

| Column | Type | Constraints |
|---|---|---|
| `id` | `INTEGER` | `PRIMARY KEY AUTOINCREMENT` |
| `github_id` | `INTEGER` | `NOT NULL UNIQUE` |
| `login` | `TEXT` | `NOT NULL` |
| `avatar_url` | `TEXT` | nullable |
| `name` | `TEXT` | nullable |
| `created_at` | `TEXT` | `DEFAULT (datetime('now'))` |
| `last_login_at` | `TEXT` | `DEFAULT (datetime('now'))` |

### `tenets`

| Column | Type | Constraints |
|---|---|---|
| `id` | `INTEGER` | `PRIMARY KEY AUTOINCREMENT` |
| `title` | `TEXT` | `NOT NULL` |
| `slug` | `TEXT` | `NOT NULL UNIQUE` |
| `status` | `TEXT` | `NOT NULL DEFAULT 'draft'` |
| `context` | `TEXT` | `NOT NULL` |
| `decision` | `TEXT` | nullable |
| `rationale` | `TEXT` | nullable |
| `proposed_by_id` | `INTEGER` | `NOT NULL REFERENCES users(id)` |
| `created_at` | `TEXT` | `DEFAULT (datetime('now'))` |
| `updated_at` | `TEXT` | `DEFAULT (datetime('now'))` |
| `superseded_by_id` | `INTEGER` | `REFERENCES tenets(id)` nullable |

Status values: `draft | voting | accepted | rejected | implemented | superseded`

### `tenet_options`

| Column | Type | Constraints |
|---|---|---|
| `id` | `INTEGER` | `PRIMARY KEY AUTOINCREMENT` |
| `tenet_id` | `INTEGER` | `NOT NULL REFERENCES tenets(id)` |
| `title` | `TEXT` | `NOT NULL` |
| `description` | `TEXT` | nullable (markdown) |
| `pros` | `TEXT` | nullable (markdown) |
| `cons` | `TEXT` | nullable (markdown) |
| `sort_order` | `INTEGER` | `NOT NULL` |

### `votes`

| Column | Type | Constraints |
|---|---|---|
| `id` | `INTEGER` | `PRIMARY KEY AUTOINCREMENT` |
| `tenet_id` | `INTEGER` | `NOT NULL REFERENCES tenets(id)` |
| `user_id` | `INTEGER` | `NOT NULL REFERENCES users(id)` |
| `choice` | `TEXT` | `NOT NULL CHECK(choice IN ('approve','abstain','block'))` |
| `reason` | `TEXT` | nullable (required if `block`, optional otherwise) |
| `created_at` | `TEXT` | `DEFAULT (datetime('now'))` |
| `updated_at` | `TEXT` | `DEFAULT (datetime('now'))` |
| | | `UNIQUE(tenet_id, user_id)` |

### Indexes

```sql
CREATE UNIQUE INDEX idx_tenets_slug ON tenets(slug);
CREATE INDEX idx_tenets_status ON tenets(status);
CREATE INDEX idx_votes_tenet ON votes(tenet_id);
CREATE INDEX idx_votes_user ON votes(user_id);
CREATE INDEX idx_options_tenet ON tenet_options(tenet_id);
```

---

## 2. Auth Flow

GitHub OAuth with KV-backed sessions:

```
GET /auth/login
  → Redirect to https://github.com/login/oauth/authorize?client_id=...&redirect_uri=...&scope=read:user

GET /auth/callback?code=...
  → Exchange code for access token (POST github.com/login/oauth/access_token)
  → Fetch user from api.github.com/user
  → UPSERT user in D1
  → Create session: KV key = session:{uuid}, value = { userId, githubToken }, TTL = 7 days
  → Set cookie: tenet_session={uuid} (HttpOnly, Secure, SameSite=Lax, Path=/)
  → Redirect to /tenets

POST /auth/logout
  → Delete KV session entry
  → Clear cookie
  → Redirect to /
```

**Session KV schema:**
```
Key:    session:{crypto.randomUUID()}
Value:  JSON.stringify({ userId: number, githubToken: string, createdAt: string })
Expiry: 604800 (7 days)
```

**Middleware (`requireAuth`)** reads `tenet_session` cookie, looks up KV, attaches user to `c.set("user", ...)`.

---

## 3. Routes

| Method | Path | Handler | Auth |
|---|---|---|---|
| `GET` | `/` | Redirect to `/tenets` | No |
| `GET` | `/auth/login` | Redirect to GitHub | No |
| `GET` | `/auth/callback` | Handle OAuth callback | No |
| `POST` | `/auth/logout` | Clear session | Yes |
| `GET` | `/tenets` | List tenets | Yes |
| `GET` | `/tenets/new` | Create form | Yes |
| `POST` | `/tenets` | Create tenet | Yes |
| `GET` | `/tenets/:slug` | Tenet detail + voting | Yes |
| `GET` | `/tenets/:slug/edit` | Edit form | Yes |
| `POST` | `/tenets/:slug` | Update tenet | Yes |
| `POST` | `/tenets/:slug/vote` | Cast/change vote | Yes |
| `POST` | `/tenets/:slug/status` | Transition status | Yes |

---

## 4. Status Flow

```
DRAFT ──→ VOTING ──→ ACCEPTED ──→ IMPLEMENTED
                       │
                       └── REJECTED

ACCEPTED or IMPLEMENTED ──→ SUPERSEDED (links to new tenet)
```

All transitions are manual button clicks (no automation for v1). Only the proposer can start voting and accept/reject. Anyone can mark as implemented.

---

## 5. Voting Rules

- Each user votes once per tenet (`UNIQUE(tenet_id, user_id)`)
- Vote can be changed while status is `voting`
- Choices:
  - **Approve** — supports the proposal (reason optional)
  - **Abstain** — no strong opinion (no reason needed)
  - **Block** — serious objection (reason **required**)
- Blocks are displayed prominently but don't automatically prevent acceptance (team discussion expected)

---

## 6. File Structure

```
src/
  api/
    Auth/
      controller.tsx        # OAuth routes
      github.ts             # GitHub API helpers (token exchange, user fetch)
    Tenets/
      controller.tsx        # API controller (JSON responses, same service as HTML)

  domains/
    models/
      user.ts               # UserRow type
      tenet.ts              # TenetRow, TenetOptionRow types
      vote.ts               # VoteRow type
    tenet/
      repo.ts               # TenetsRepository extends RepositoryBase
      queries/
        *.sql               # SQL files with YAML front matter
        queries.generated.ts # Auto-generated typed query barrel
    vote/
      repo.ts               # VotesRepository extends RepositoryBase
    user/
      repo.ts               # UsersRepository extends RepositoryBase
    requests/
      ProposeTenetRequest.ts   # implements IValidatable — validates create input
      VoteRequest.ts           # implements IValidatable — validates vote input

  services/
    TenetsService.ts         # TenetService extends ServiceBase — business logic shared by HTML + API controllers

  infrastructure/
    RepositoryBase.ts       # Abstract base with generic CRUD, dynamic finders, typed query helpers
    services/
      ServiceBase.ts        # Abstract base with error/validation helpers
    validation/
      IValidatable.ts        # IValidatable interface + ValidationResult type
      GuardDescriptor.ts     # Guard types for decorator metadata
      decorators.ts          # @Exists, @Authorize, @Validate factories
      guard-executor.ts      # executeGuard() — invoked by ControllerBase
    middleware/
      auth.tsx              # requireAuth middleware

  pages/
    Auth/                    (controller lives in api/Auth/controller.tsx)

    Tenets/
      controller.tsx        # HTML controller (uses shared services)
      view-builder.ts       # Async builders: index, show, new, edit
      view-model.ts         # ViewModel interfaces
      views/
        index.tsx           # Tenet list
        show.tsx            # Tenet detail + voting
        new.tsx             # Create form
        edit.tsx            # Edit form

  components/
    TenetCard/
      index.tsx
      index.module.css
    VoteButtons/
      index.tsx
      index.module.css
    VoteProgress/
      index.tsx
      index.module.css
    StatusBadge/
      index.tsx
      index.module.css
    UserAvatar/
      index.tsx
      index.module.css

  handlers/
    VoteHandler.ts
    StatusTransitionHandler.ts

  layouts/
    Layout.tsx

migrations/
  001_create_tables.sql
```

---

## 7. ViewModel Types

```typescript
// pages/Tenets/view-model.ts

export interface TenetListViewModel {
  tenets: TenetSummary[];
  currentUser: UserInfo;
}

export interface TenetSummary {
  id: number;
  title: string;
  slug: string;
  status: TenetStatus;
  proposedBy: UserInfo;
  voteCount: number;
  approveCount: number;
  blockCount: number;
  createdAt: string;
}

export interface TenetDetailViewModel {
  tenet: TenetDetail;
  options: TenetOptionInfo[];
  votes: VoteWithUser[];
  currentUser: UserInfo;
  userVote: VoteWithUser | null;
  canVote: boolean;         // status === "voting"
  canTransition: boolean;    // proposer or appropriate status
}

export interface TenetDetail {
  id: number;
  title: string;
  slug: string;
  status: TenetStatus;
  context: string;
  decision: string | null;
  rationale: string | null;
  proposedBy: UserInfo;
  createdAt: string;
  updatedAt: string;
  supersededBy: TenetSummary | null;
}

export interface TenetOptionInfo {
  id: number;
  title: string;
  description: string | null;
  pros: string | null;
  cons: string | null;
}

export interface VoteWithUser {
  id: number;
  tenetId: number;
  userId: number;
  choice: "approve" | "abstain" | "block";
  reason: string | null;
  user: UserInfo;
}

export interface UserInfo {
  id: number;
  login: string;
  avatarUrl: string | null;
  name: string | null;
}

export interface TenetFormViewModel {
  isEditing: boolean;
  tenet?: TenetDetail & { options: TenetOptionInfo[] };
  validationErrors?: Record<string, string>;
}

export type TenetStatus =
  | "draft" | "voting" | "accepted"
  | "rejected" | "implemented" | "superseded";
```

---

## 8. Data Models

Row type definitions live in `src/domains/models/`, one file per entity. These are plain TypeScript interfaces matching the D1 table columns, prefixed with the entity name (e.g., `TenetRow`).

```typescript
// src/domains/models/user.ts

export interface UserRow {
  id: number;
  github_id: number;
  login: string;
  avatar_url: string | null;
  name: string | null;
  created_at: string;
  last_login_at: string;
}
```

```typescript
// src/domains/models/tenet.ts

export type TenetStatus =
  | "draft" | "voting" | "accepted"
  | "rejected" | "implemented" | "superseded";

export interface TenetRow {
  id: number;
  title: string;
  slug: string;
  status: TenetStatus;
  context: string;
  decision: string | null;
  rationale: string | null;
  proposed_by_id: number;
  created_at: string;
  updated_at: string;
  superseded_by_id: number | null;
}

export interface TenetOptionRow {
  id: number;
  tenet_id: number;
  title: string;
  description: string | null;
  pros: string | null;
  cons: string | null;
  sort_order: number;
}
```

```typescript
// src/domains/models/vote.ts

export interface VoteRow {
  id: number;
  tenet_id: number;
  user_id: number;
  choice: "approve" | "abstain" | "block";
  reason: string | null;
  created_at: string;
  updated_at: string;
}
```

These models are imported by repositories (for query return types) and view-builders (for shaping into ViewModels). They are distinct from ViewModels — models mirror the DB schema, ViewModels mirror the page's UI needs.

---

## 9. Repository Layer Pattern

### Base class (`infrastructure/RepositoryBase.ts`)

Follows the same pattern as `ControllerBase` and `BaseHandler` — abstract base with concrete subclasses. D1Database is injected via constructor; repos are created per-request using factory functions.

```typescript
// src/infrastructure/RepositoryBase.ts

export abstract class RepositoryBase<T extends { id: number }, QM = {}> {
  /** Each repo declares its table name. */
  abstract readonly tableName: string;

  /** Optional query map for type-safe SQL queries. Override in subclasses that use .sql files. */
  protected readonly queries?: { [P in keyof QM]: string };

  /** The database connection for this repository instance. */
  protected readonly db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  // ── Static utilities ──
  static resolveNamedParams(sql: string, params: Record<string, unknown>): [string, unknown[]] { /* ... */ }
  static isPlainObject(v: unknown): v is Record<string, unknown> { /* ... */ }
  static validateOrderBy(orderBy: string): void { /* ... */ }
  static validateColumnName(key: string): void { /* ... */ }

  // ── Generic CRUD ──────────────────────────────────

  async findById(id: number): Promise<T | null> { /* ... */ }
  async findAll(options?: { orderBy?: string; limit?: number }): Promise<T[]> { /* ... */ }
  async create(data: Partial<T>): Promise<T> { /* ... */ }
  async update(id: number, data: Partial<T>): Promise<T | null> { /* ... */ }
  async delete(id: number): Promise<boolean> { /* ... */ }
  async count(): Promise<number> { /* ... */ }

  // ── Dynamic finders (for simple lookups without .sql files) ──
  // Handles null values correctly using IS NULL (since `col = NULL` is always false in SQL)
  async findOneBy(criteria: Partial<T>): Promise<T | null> { /* ... */ }
  async findAllBy(criteria: Partial<T>): Promise<T[]> { /* ... */ }
  async existsBy(criteria: Partial<T>): Promise<boolean> { /* ... */ }
  async deleteBy(criteria: Partial<T>): Promise<number> { /* ... */ }

  // ── Typed query helpers (for complex queries from .sql files) ──
  protected queryOne<K extends keyof QM>(
    name: K,
    ...args: QM[K] extends { params: infer P } ? ({} extends P ? [] : [P]) : []
  ): Promise<(QM[K] extends { result: infer R } ? R : unknown) | null> { /* ... */ }

  protected queryAll<K extends keyof QM>(
    name: K,
    ...args: QM[K] extends { params: infer P } ? ({} extends P ? [] : [P]) : []
  ): Promise<(QM[K] extends { result: infer R } ? R : unknown)[]> { /* ... */ }

  protected execute<K extends keyof QM>(
    name: K,
    ...args: QM[K] extends { params: infer P } ? ({} extends P ? [] : [P]) : []
  ): Promise<D1Result> { /* ... */ }
}
```

### Security Features

`RepositoryBase` includes built-in validation to prevent SQL injection:

| Method | Validates | Example |
|---|---|---|
| `validateColumnName()` | Column names in `create`, `update`, dynamic finders | Rejects `"123abc"`, allows `"slug"` |
| `validateOrderBy()` | ORDER BY clauses in `findAll()` | Rejects SQL keywords, allows `col ASC, col2 DESC` |
| `_buildWhere()` | Null handling in dynamic finders | Uses `IS NULL` instead of `= NULL` |
| Empty criteria check | Dynamic finders | Throws on `{}` to prevent full-table operations |

### Concrete example (`domains/tenet/repo.ts`)

```typescript
// src/domains/tenet/repo.ts

import { RepositoryBase } from "infrastructure/RepositoryBase";
import { queries, type QueryMap } from "./queries/queries.generated";
import type { Tenet } from "domains/db-types";
import type { TenetStatus } from "./model";

export class TenetsRepository extends RepositoryBase<Tenet, QueryMap> {
  override readonly tableName = "tenets";
  protected override readonly queries = queries;

  // No constructor needed — inherited from RepositoryBase

  // Simple lookups use dynamic finders (no .sql file needed)
  // e.g., tenetsRepo(db).findOneBy({ slug: "my-tenet" })

  // Complex queries use typed helpers from .sql files
  async getOptions(tenetId: number) {
    return this.queryAll("getOptions", { tenetId });
    // Return type: TenetOption[] — inferred from QueryMap
  }

  async listWithProposer() {
    return this.queryAll("listWithProposer");
    // Return type: (Tenet & { proposer_login: string; proposer_avatar: string | null })[]
  }

  async getWithProposer(slug: string) {
    return this.queryOne("getWithProposer", { slug });
  }

  async createWithOptions(
    tenet: { title: string; slug: string; context: string; proposed_by_id: number },
    options: { title: string; description?: string; pros?: string; cons?: string }[],
  ) {
    const row = await this.create(tenet as Partial<Tenet>);

    for (let i = 0; i < options.length; i++) {
      const opt = options[i];
      await this.execute("insertOption", {
        tenetId: row.id,
        title: opt.title,
        description: opt.description ?? null,
        pros: opt.pros ?? null,
        cons: opt.cons ?? null,
        sortOrder: i,
      });
    }

    return row;
  }

  async updateStatus(id: number, status: TenetStatus): Promise<void> {
    await this.execute("updateStatus", { id, status });
  }
}

// Factory function — repos are created per-request with db injection
export const tenetsRepo = (db: D1Database) => new TenetsRepository(db);
```

### Usage in a ViewBuilder

```typescript
// pages/Tenets/view-builder.ts

import { tenetsRepo } from "../../domains/tenet/repo";
import { votesRepo } from "../../domains/vote/repo";

export const viewBuilder = {
  async show(env: Env, slug: string, currentUserId?: number) {
    const tenet = await tenetsRepo(env.DB).findOneBy({ slug });
    if (!tenet) throw new NotFoundError("Tenet not found");

    const options = await tenetsRepo(env.DB).getOptions(tenet.id);
    const votes = await votesRepo(env.DB).listWithUsers(tenet.id);
    const userVote = votes.find(v => v.user_id === currentUserId) ?? null;

    return {
      tenet: { ...tenet, proposedBy: /* ... */ },
      options,
      votes,
      userVote,
      // ...
    } satisfies TenetDetailViewModel;
  },
};
```

Note: `create` and `update` on the base class use dynamic SQL via `Object.keys()`. Column names are validated using `validateColumnName()` to prevent SQL injection. For complex operations, subclasses should use the protected helpers (`queryAll`, `queryOne`, `execute`) directly.

---

## 10. Service Layer

A thin business-logic layer shared between HTML and JSON controllers. Services own validation, authorization, and orchestration. Controllers own HTTP (parsing requests, formatting responses).

### Architecture flow

```
pages/Tenets/controller.tsx          api/Tenets/controller.tsx
  (HTML via c.render)                   (JSON via c.json)
        │                                      │
        └──────────────┬───────────────────────┘
                       │
                 services/TenetsService.ts
                  (validation, authz, orchestration)
                       │
                 domains/repos/tenets.ts
                  (D1 queries via RepositoryBase)
```

### ServiceBase (`infrastructure/services/ServiceBase.ts`)

```typescript
export abstract class ServiceBase {
  // ── Error helpers ──────────────────────────────

  protected validationError(
    message: string,
    fields?: Record<string, string>
  ): never {
    throw new ValidationError(message, fields);
  }

  protected notFound(message = "Resource not found"): never {
    throw new NotFoundError(message);
  }

  protected forbidden(message = "You don't have permission"): never {
    throw new ForbiddenError(message);
  }

  protected conflict(message = "Resource already exists"): never {
    throw new ConflictError(message);
  }

  // ── Validation helper ──────────────────────────

  protected require(condition: boolean, message: string): void {
    if (!condition) throw new ValidationError(message);
  }
}
```

### Service example (`services/TenetsService.ts`)

```typescript
import { ServiceBase } from "../infrastructure/services/ServiceBase";
import { tenetsRepo } from "../domains/tenet/repo";
import { votesRepo } from "../domains/vote/repo";
import type { Tenet, TenetOption, Vote } from "../domains/db-types";
import type { UserInfo } from "../pages/Tenets/view-model";

// ── Input DTOs ───────────────────────────────────

export interface ProposeTenetInput {
  title: string;
  context: string;
  options: { title: string; description?: string; pros?: string; cons?: string }[];
}

export interface VoteInput {
  choice: "approve" | "abstain" | "block";
  reason?: string;
}

// ── Output DTOs (shared by HTML + API controllers) ─

export interface TenetDetail {
  id: number;
  title: string;
  slug: string;
  status: TenetStatus;
  context: string;
  decision: string | null;
  rationale: string | null;
  options: TenetOptionDetail[];
  votes: VoteDetail[];
  proposedBy: UserInfo;
  createdAt: string;
  updatedAt: string;
}

export interface TenetOptionDetail {
  id: number;
  title: string;
  description: string | null;
  pros: string | null;
  cons: string | null;
}

export interface VoteDetail {
  userId: number;
  user: UserInfo;
  choice: "approve" | "abstain" | "block";
  reason: string | null;
}

// ── Service ──────────────────────────────────────

class TenetsService extends ServiceBase {
  async getBySlug(db: D1Database, slug: string): Promise<TenetDetail> {
    const tenet = await tenetsRepo(db).findOneBy({ slug });
    if (!tenet) this.notFound("Tenet not found");

    const options = await tenetsRepo(db).getOptions(tenet.id);
    const votes = await votesRepo(db).listWithUsers(tenet.id);

    return this.toDetail(tenet, options, votes);
  }

  async propose(
    db: D1Database,
    userId: number,
    input: ProposeTenetInput,
  ): Promise<TenetDetail> {
    this.require(input.title.trim().length > 0, "Title is required");
    this.require(input.context.trim().length > 0, "Context is required");
    this.require(input.options.length > 0, "At least one option is required");

    const slug = input.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

    const tenet = await tenetsRepo(db).createWithOptions(
      {
        title: input.title,
        slug,
        context: input.context,
        proposed_by_id: userId,
      },
      input.options,
    );

    return this.getBySlug(db, tenet.slug);
  }

  async vote(
    db: D1Database,
    userId: number,
    slug: string,
    input: VoteInput,
  ): Promise<TenetDetail> {
    const tenet = await tenetsRepo(db).findOneBy({ slug });
    if (!tenet) this.notFound("Tenet not found");
    this.require(tenet.status === "voting", "Tenet is not in voting phase");
    this.require(
      input.choice !== "block" || (input.reason?.trim() ?? "").length > 0,
      "Blocking requires a reason",
    );

    await votesRepo(db).upsert(tenet.id, userId, input.choice, input.reason ?? null);

    return this.getBySlug(db, slug);
  }

  async transitionStatus(
    db: D1Database,
    userId: number,
    slug: string,
    newStatus: TenetStatus,
  ): Promise<TenetDetail> {
    const tenet = await tenetsRepo(db).findOneBy({ slug });
    if (!tenet) this.notFound("Tenet not found");
    this.require(
      this.canTransition(tenet, userId, newStatus),
      "This transition is not allowed",
    );

    await tenetsRepo(db).updateStatus(tenet.id, newStatus);

    return this.getBySlug(db, slug);
  }

  // ── Private helpers ────────────────────────────

  private canTransition(tenet: Tenet, userId: number, to: TenetStatus): boolean {
    const isProposer = tenet.proposed_by_id === userId;
    const transitions: Record<TenetStatus, TenetStatus[]> = {
      draft: ["voting"],
      voting: ["accepted", "rejected"],
      accepted: ["implemented", "superseded"],
      rejected: [],
      implemented: ["superseded"],
      superseded: [],
    };
    const allowed = transitions[tenet.status] ?? [];
    return allowed.includes(to) && (to === "implemented" || isProposer);
  }

  private toDetail(
    tenet: Tenet,
    options: TenetOption[],
    votes: Vote[],
  ): TenetDetail {
    return {
      id: tenet.id,
      title: tenet.title,
      slug: tenet.slug,
      status: tenet.status,
      context: tenet.context,
      decision: tenet.decision,
      rationale: tenet.rationale,
      options: options.map((o) => ({
        id: o.id,
        title: o.title,
        description: o.description,
        pros: o.pros,
        cons: o.cons,
      })),
      votes: votes.map((v) => ({
        userId: v.user_id,
        user: null as any, // hydrated in getBySlug
        choice: v.choice,
        reason: v.reason,
      })),
      proposedBy: null as any,
      createdAt: tenet.created_at,
      updatedAt: tenet.updated_at,
    };
  }
}

export const tenetService = new TenetsService();
```

### Dual controller example

**HTML controller** (existing pattern, now delegates to service):

```typescript
// pages/Tenets/controller.tsx

class TenetsController extends ControllerBase {
  override base = "tenets";

  @Get("/:slug")
  async show(c: Context) {
    const user = c.get("user") as UserInfo;
    const detail = await tenetService.getBySlug(c.env.DB, c.req.param("slug"));
    const vm = viewBuilder.show(detail, user);
    return c.render(<TenetDetailView {...vm} />);
  }

  @Post("/:slug/vote")
  async vote(c: Context) {
    const user = c.get("user") as UserInfo;
    const body = await c.req.parseBody();
    await tenetService.vote(c.env.DB, user.id, c.req.param("slug"), {
      choice: body.choice as any,
      reason: body.reason as string | undefined,
    });
    return c.redirect(`/tenets/${c.req.param("slug")}`);
  }
}
```

**API controller** (new, shared service + JSON responses):

```typescript
// api/Tenets/controller.tsx

class TenetsApiController extends ControllerBase {
  override base = "api/tenets";

  @Get("/:slug")
  async show(c: Context) {
    const user = c.get("user") as UserInfo;
    const detail = await tenetService.getBySlug(c.env.DB, c.req.param("slug"));
    return c.json(detail);
  }

  @Post("/")
  async create(c: Context) {
    const user = c.get("user") as UserInfo;
    const body = await c.req.json<ProposeTenetInput>();
    const tenet = await tenetService.propose(c.env.DB, user.id, body);
    return c.json(tenet, 201);
  }

  @Post("/:slug/vote")
  async vote(c: Context) {
    const user = c.get("user") as UserInfo;
    const body = await c.req.json<VoteInput>();
    const detail = await tenetService.vote(c.env.DB, user.id, c.req.param("slug"), body);
    return c.json(detail);
  }
}
```

### Type layers comparison

| Layer | Types | Purpose |
|---|---|---|
| **Models** (`domains/models/`) | `TenetRow`, `VoteRow` | Mirror D1 schema, used by repos |
| **Service DTOs** (`services/`) | `TenetDetail`, `VoteInput` | Shared between HTML + API controllers |
| **ViewModels** (`pages/Tenets/view-model.ts`) | `TenetDetailViewModel` | HTML-only: adds UI state (`canVote`, `currentUser`) |

ViewBuilders take **Service DTOs** and enrich them with presentation data. API controllers return **Service DTOs** directly as JSON.

---

## 11. Validation & Guard Decorators

A decorator-based guard layer that runs before controller handlers. Guards handle common concerns — loading entities, checking permissions, validating request bodies — by storing metadata that `ControllerBase.register()` processes at route-wiring time.

### Architecture

```
                  ┌──────────────────────────┐
                  │  Handler method runs      │
                  │  after all guards pass    │
                  └──────────┬───────────────┘
                             │
           ┌─────────────────┼─────────────────┐
           │                 │                 │
     @Exists(key, load) @Authorize(check) @Validate(RequestClass)
           │                 │                 │
      Loads entity,    Checks permission,  Parses body,
      attaches to ctx, throws on failure   constructs request,
      throws 404 if                         runs validate(),
      null                                  throws on failure
```

Each guard is a `GuardDescriptor` stored in `context.metadata` — same mechanism as `RouteDescriptor`.

### IValidatable interface

```typescript
// src/infrastructure/validation/IValidatable.ts

export interface ValidationResult {
  valid: boolean;
  errors?: Record<string, string>;
}

export interface IValidatable {
  validate(): ValidationResult | Promise<ValidationResult>;
}
```

### Guard types

```typescript
// src/infrastructure/validation/GuardDescriptor.ts

export interface ExistsGuard {
  type: "exists";
  handlerName: string;
  key: string;             // Context key to store loaded entity
  load: (c: Context) => Promise<unknown>;  // Returns entity or null
}

export interface AuthorizeGuard {
  type: "authorize";
  handlerName: string;
  check: (c: Context) => Promise<void>;    // Throws on failure
}

export interface ValidateGuard {
  type: "validate";
  handlerName: string;
  RequestClass: new (body: Record<string, unknown>) => IValidatable;
}

export type GuardDescriptor = ExistsGuard | AuthorizeGuard | ValidateGuard;
```

### Decorator factories

```typescript
// src/infrastructure/validation/decorators.ts

const GUARDS_KEY = Symbol("hono:guards");

export function Exists(key: string, load: (c: Context) => Promise<unknown>) {
  return function <This>(
    _target: (this: This, ...args: any[]) => any,
    context: ClassMethodDecoratorContext<This>,
  ): void {
    const guards: GuardDescriptor[] =
      ((context.metadata as any)[GUARDS_KEY] as GuardDescriptor[]) ??= [];
    guards.push({ type: "exists", key, load, handlerName: String(context.name) });
  };
}

export function Authorize(check: (c: Context) => Promise<void> | void) {
  return function <This>(
    _target: (this: This, ...args: any[]) => any,
    context: ClassMethodDecoratorContext<This>,
  ): void {
    const guards: GuardDescriptor[] =
      ((context.metadata as any)[GUARDS_KEY] as GuardDescriptor[]) ??= [];
    guards.push({ type: "authorize", check: async (c) => { await check(c); }, handlerName: String(context.name) });
  };
}

export function Validate(RequestClass: new (body: Record<string, unknown>) => IValidatable) {
  return function <This>(
    _target: (this: This, ...args: any[]) => any,
    context: ClassMethodDecoratorContext<This>,
  ): void {
    const guards: GuardDescriptor[] =
      ((context.metadata as any)[GUARDS_KEY] as GuardDescriptor[]) ??= [];
    guards.push({ type: "validate", RequestClass, handlerName: String(context.name) });
  };
}
```

### Guard executor

```typescript
// src/infrastructure/validation/guard-executor.ts

import { NotFoundError, ValidationError } from "../errors";
import type { GuardDescriptor } from "./GuardDescriptor";
import type { IValidatable } from "./IValidatable";

export async function executeGuard(guard: GuardDescriptor, c: Context): Promise<void> {
  switch (guard.type) {
    case "exists": {
      const entity = await guard.load(c);
      if (entity == null) throw new NotFoundError();
      c.set(guard.key, entity);
      break;
    }
    case "authorize": {
      await guard.check(c);
      break;
    }
    case "validate": {
      const contentType = c.req.header("content-type") ?? "";
      let body: Record<string, unknown>;

      if (contentType.includes("application/json")) {
        body = await c.req.json();
      } else {
        const raw = await c.req.parseBody();
        body = Object.fromEntries(
          Object.entries(raw).map(([k, v]) => [k, v as unknown]),
        );
      }

      const instance = new guard.RequestClass(body);
      const result = await instance.validate();

      if (!result.valid) {
        throw new ValidationError("Invalid input", result.errors);
      }

      c.set("validated", instance);
      break;
    }
  }
}
```

### ControllerBase changes

The `register()` method now reads guard metadata alongside route metadata and runs guards before each handler:

```typescript
register<E extends Env>(app: Hono<E>): void {
  const metadata = (this.constructor as any)[Symbol.metadata];
  const routes: RouteDescriptor[] = metadata?.[ROUTES_KEY] ?? [];
  const guards: GuardDescriptor[] = metadata?.[GUARDS_KEY] ?? [];

  // ... existing middleware setup (layout renderer) ...

  for (const route of routes) {
    const handlerGuards = guards.filter(g => g.handlerName === route.handlerName);

    this._app[route.method](route.path, async (c: Context) => {
      try {
        for (const guard of handlerGuards) {
          await executeGuard(guard, c);
        }
        return (this as any)[route.handlerName](c);
      } catch (error: unknown) {
        return handleError(c, error);
      }
    });
  }

  app.route(this.base, this._app);
}
```



### Request objects

```typescript
// src/domains/requests/ProposeTenetRequest.ts

export class ProposeTenetRequest implements IValidatable {
  readonly title: string;
  readonly context: string;
  readonly options: { title: string; description?: string; pros?: string; cons?: string }[];

  constructor(body: Record<string, unknown>) {
    this.title = (body.title as string) ?? "";
    this.context = (body.context as string) ?? "";
    this.options = (body.options as any[]) ?? [];
  }

  validate(): ValidationResult {
    const errors: Record<string, string> = {};
    if (!this.title.trim()) errors.title = "Title is required";
    if (!this.context.trim()) errors.context = "Context is required";
    if (this.options.length === 0) errors.options = "At least one option is required";
    return { valid: Object.keys(errors).length === 0, errors };
  }
}
```

```typescript
// src/domains/requests/VoteRequest.ts

export class VoteRequest implements IValidatable {
  readonly choice: "approve" | "abstain" | "block";
  readonly reason?: string;

  constructor(body: Record<string, unknown>) {
    this.choice = body.choice as any;
    this.reason = body.reason as string | undefined;
  }

  validate(): ValidationResult {
    const errors: Record<string, string> = {};
    const validChoices = ["approve", "abstain", "block"];
    if (!validChoices.includes(this.choice)) {
      errors.choice = "Must be approve, abstain, or block";
    }
    if (this.choice === "block" && !this.reason?.trim()) {
      errors.reason = "Blocking requires a reason";
    }
    return { valid: Object.keys(errors).length === 0, errors };
  }
}
```

### Usage in controllers

**HTML controller:**
```typescript
class TenetsController extends ControllerBase {
  override base = "tenets";

  @Get("/:slug")
  @Exists("tenet", (c) => tenetsRepo(c.env.DB).findOneBy({ slug: c.req.param("slug")! }))
  async show(c: Context) {
    const tenet = c.get("tenet") as Tenet;
    return c.render(<TenetView {...viewBuilder.show(tenet)} />);
  }

  @Post("/:slug/vote")
  @Exists("tenet", (c) => tenetsRepo(c.env.DB).findOneBy({ slug: c.req.param("slug")! }))
  @Validate(VoteRequest)
  async vote(c: Context) {
    const tenet = c.get("tenet") as Tenet;
    const input = c.get("validated") as VoteRequest;
    await tenetService.vote(c.env.DB, c.get("user").id, tenet.slug, input);
    return c.redirect(`/tenets/${tenet.slug}`);
  }
}
```

**API controller:**
```typescript
class TenetsApiController extends ControllerBase {
  override base = "api/tenets";

  @Post("/")
  @Validate(ProposeTenetRequest)
  async create(c: Context) {
    const input = c.get("validated") as ProposeTenetRequest;
    const tenet = await tenetService.propose(c.env.DB, c.get("user").id, input);
    return c.json(tenet, 201);
  }

  @Post("/:slug/vote")
  @Exists("tenet", (c) => tenetsRepo(c.env.DB).findOneBy({ slug: c.req.param("slug")! }))
  @Validate(VoteRequest)
  async vote(c: Context) {
    const tenet = c.get("tenet") as Tenet;
    const input = c.get("validated") as VoteRequest;
    await tenetService.vote(c.env.DB, c.get("user").id, tenet.slug, input);
    return c.json({ success: true });
  }
}
```

### Guard evaluation order

Guards run in **declaration order** (top-to-bottom on the method). For a typical CREATE flow:

```typescript
@Post("/")
@Exists("tenet", ...)    // 1. Load entity (guards may depend on this)
@Authorize(...)           // 2. Check permission (needs entity from step 1)
@Validate(VoteRequest)   // 3. Validate body
async handler(c) { ... } // 4. Run handler
```

This lets each guard build on the previous one — `@Authorize` can read the entity loaded by `@Exists`.

---

## 12. Client Handlers

### VoteHandler

```typescript
// handlers/VoteHandler.ts

export class VoteHandler extends BaseHandler {
  static override readonly handlerName = "vote";

  /** Called when approve/abstain/block is clicked */
  submit(event: Event): void {
    const target = event.currentTarget as HTMLElement;
    const choice = target.getAttribute("data-vote-choice");
    const form = this.element.closest("form") as HTMLFormElement;

    if (choice === "block") {
      const reason = prompt("Why are you blocking this tenet?");
      if (!reason) {
        event.preventDefault();
        return;
      }
      form.querySelector<HTMLInputElement>("[name=reason]")!.value = reason;
    }

    form.querySelector<HTMLInputElement>("[name=choice]")!.value = choice;
    form.requestSubmit();
  }
}
```

### StatusTransitionHandler

```typescript
// handlers/StatusTransitionHandler.ts

export class StatusTransitionHandler extends BaseHandler {
  static override readonly handlerName = "status";

  transition(event: Event): void {
    const target = event.currentTarget as HTMLElement;
    const status = target.getAttribute("data-status-target");
    const message = target.getAttribute("data-status-message") ?? "Change status?";

    if (!confirm(message)) {
      event.preventDefault();
      return;
    }

    const form = this.element.closest("form") as HTMLFormElement;
    form.querySelector<HTMLInputElement>("[name=status]")!.value = status;
    form.requestSubmit();
  }
}
```

---

## 13. Configuration Changes

### `wrangler.jsonc` additions

```jsonc
{
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "tenet-db",
      "database_id": "<created-by-wrangler>"
    }
  ],
  "kv_namespaces": [
    {
      "binding": "SESSIONS",
      "id": "<created-by-wrangler>"
    }
  ]
}
```

### `worker-configuration.d.ts` — after `wrangler types` regeneration

```typescript
interface CloudflareBindings extends Cloudflare.Env {
  DB: D1Database;
  SESSIONS: KVNamespace;
}
```

### GitHub OAuth — environment variables

```jsonc
// wrangler.jsonc vars or .dev.vars
"vars": {
  "GITHUB_CLIENT_ID": "xxx",
  "GITHUB_CLIENT_SECRET": "xxx"
}
```

---

## 14. Existing Files to Touch

| File | Change |
|---|---|
| `wrangler.jsonc` | Add D1 + KV bindings, GitHub OAuth vars |
| `worker-configuration.d.ts` | Regenerate after bindings |
| `src/infrastructure/controllers/index.ts` | Register AuthController + TenetsController + TenetsApiController |
| `src/infrastructure/ControllerBase.tsx` | Read and execute guard metadata in register() |
| `src/infrastructure/client/index.ts` | Import VoteHandler + StatusTransitionHandler |
| `src/utils/Action.tsx` | Add `vote` and `status` to `HandlerActions` |
| `src/layouts/Layout.tsx` | Update nav with auth state (login/logout, user avatar) |
| `src/index.tsx` | Update root route (currently redirects to `/home`) |
| `src/services/TenetsService.ts` | New file: business logic shared by HTML + API |
| `src/infrastructure/services/ServiceBase.ts` | New file: abstract base class |
| `src/infrastructure/RepositoryBase.ts` | Update: add dynamic finders, typed query helpers, security validation |
| `src/infrastructure/validation/IValidatable.ts` | New file: interface + types |
| `src/infrastructure/validation/GuardDescriptor.ts` | New file: guard types |
| `src/infrastructure/validation/decorators.ts` | New file: @Exists, @Authorize, @Validate |
| `src/infrastructure/validation/guard-executor.ts` | New file: executeGuard logic |
| `src/domains/requests/ProposeTenetRequest.ts` | New file: IValidatable form request |
| `src/domains/requests/VoteRequest.ts` | New file: IValidatable form request |
| `src/api/Tenets/controller.tsx` | New file: API controller (JSON) |

---

## 15. Implementation Milestones

### Milestone 1 — Foundation

- Create D1 database + KV namespace via wrangler
- Update `wrangler.jsonc` and regenerate types
- Write and apply migration `001_create_tables.sql`
- Implement `domains/models/` (user.ts, tenet.ts, vote.ts)
- Implement `domains/user/repo.ts` (UsersRepository)
- Update `infrastructure/RepositoryBase.ts` (add dynamic finders, typed query helpers, security validation)
- Implement `infrastructure/services/ServiceBase.ts` (abstract base class)
- Implement `infrastructure/validation/IValidatable.ts` (interface + types)
- Implement `infrastructure/validation/GuardDescriptor.ts` (guard types)
- Implement `infrastructure/validation/decorators.ts` (@Exists, @Authorize, @Validate)
- Implement `infrastructure/validation/guard-executor.ts` (executeGuard)
- Update `infrastructure/ControllerBase.tsx` (read + execute guards in register())
- Implement `api/Auth/github.ts` (token exchange, user fetch)
- Implement `api/Auth/controller.tsx` (login, callback, logout)
- Implement `infrastructure/middleware/auth.tsx` (session check)
- Update `Layout.tsx` nav (login/logout, user avatar)
- Register AuthController

### Milestone 2 — Tenet CRUD

- Implement `domains/tenet/repo.ts` (TenetsRepository)
- Implement `domains/vote/repo.ts` (VotesRepository)
- Implement `domains/requests/ProposeTenetRequest.ts` (IValidatable form request)
- Implement `domains/requests/VoteRequest.ts` (IValidatable form request)
- Implement `services/TenetsService.ts` (business logic — validation, authz, orchestration)
- Implement `pages/Tenets/view-model.ts`
- Implement `pages/Tenets/view-builder.ts` (now shapes Service DTOs into ViewModels)
- Implement `pages/Tenets/views/new.tsx` (create form with dynamic options)
- Implement `pages/Tenets/views/index.tsx` (list)
- Implement `pages/Tenets/views/show.tsx` (detail)
- Implement `pages/Tenets/views/edit.tsx` (edit form)
- Implement `pages/Tenets/controller.tsx` (HTML — delegates to service, guards on routes)
- Implement `api/Tenets/controller.tsx` (REST API — delegates to same service, guards on routes)
- Build components: `TenetCard`, `StatusBadge`, `UserAvatar`
- Register TenetsController + TenetsApiController
- Update root redirect

### Milestone 3 — Testing Foundation

> **Gate:** All tests must pass before proceeding to Milestone 4. This ensures the data access layer and UI rendering are verified before building interactive features on top of them.

- Add CSS module shim to vitest setup (`vitest.setup.ts`)
- Write repository integration tests (`domains/tenet/repo.test.ts`, `domains/vote/repo.test.ts`, `domains/user/repo.test.ts`)
  - CRUD operations, joins, filters, ordering, edge cases (nulls, duplicates, FK violations)
- Write view/component render tests
  - `pages/Tenets/views/index.test.tsx` — empty state, populated list, status badges
  - `pages/Tenets/views/show.test.tsx` — detail view, voting states, transitions
  - `pages/Tenets/views/new.test.tsx` — form rendering, validation errors
  - Component tests: `TenetCard`, `StatusBadge`, `UserAvatar`
- Run full test suite, verify all pass
- Update coverage table in Section 17

### Milestone 4 — Voting + Status

- Build `VoteButtons` component
- Build `VoteProgress` component
- Add vote routes to TenetsController
- Implement `handlers/VoteHandler.ts`
- Add status transition routes to TenetsController
- Implement `handlers/StatusTransitionHandler.ts`
- Add `vote` and `status` to HandlerActions
- Register handlers in client/index.ts

### Milestone 5 — Polish

- Empty state for tenets list
- Error handling for form validation
- Loading states
- Supersede relationship UI
- Slug auto-generation from title
- Verify full flow: login → create → vote → accept → implement → supersede

---

## 16. Ready Checklist

Before implementation starts:

- [ ] Run `npx wrangler d1 create tenet-db` → paste ID into wrangler.jsonc
- [ ] Run `npx wrangler kv namespace create SESSIONS` → paste ID into wrangler.jsonc
- [ ] Create GitHub OAuth app (dev) → get client ID + secret
- [ ] Create `.dev.vars` with `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`
- [ ] Run `npm run cf-typegen` to regenerate binding types
- [ ] Run `npx wrangler d1 migrations apply tenet-db` to create tables

---

## 17. Testing Strategy

### Tools

| Tool | Purpose |
|---|---|
| **Vitest** | Test runner |
| **`@cloudflare/vitest-pool-workers`** | Workers/D1/KV bindings in tests via `cloudflareTest` plugin |
| **`hono/jsx/dom/server`** | `renderToString` for server-side JSX render testing |
| **`hono/testing`** | `testClient` for HTTP endpoint tests |

### Test Location Convention

Tests live alongside the code they test, using a `.test.ts` or `.test.tsx` suffix:

```
src/domains/requests/ProposeTenetRequest.ts
src/domains/requests/ProposeTenetRequest.test.ts     ← colocated

src/services/TenetsService.ts
src/services/TenetsService.test.ts                 ← colocated
```

---

### Test Layers

#### 1. Request Validation — Pure Unit Tests

No bindings, no rendering. Fastest tier.

```typescript
// src/domains/requests/ProposeTenetRequest.test.ts
it("rejects empty title", () => {
  const req = new ProposeTenetRequest({
    title: "", context: "c", options: [{ title: "A" }],
  });
  expect(req.validate().valid).toBe(false);
});
```

**Scope:** Every `IValidatable` class — each validation rule in isolation, plus valid inputs.

**Status:** ✅ 10 tests (ProposeTenetRequest + VoteRequest)

---

#### 2. Repository — Integration Tests with D1

Data access layer against real D1 via the Workers pool.

```typescript
// src/domains/tenet/repo.test.ts
import { env } from "cloudflare:workers";
import { tenetsRepo } from "./repo";

it("creates and finds by slug", async () => {
  await tenetsRepo(env.DB).createWithOptions({ ... }, []);
  const found = await tenetsRepo(env.DB).findOneBy({ slug: "test-slug" });
  expect(found).not.toBeNull();
});
```

**Setup:** `beforeAll` runs `initDatabase(env.DB)` to apply schema.

**Scope:** Each repository method — CRUD, joins, filters, ordering.

**Status:** ⬜ Milestone 3 — top priority.

---

#### 3. Service — Integration Tests with D1

Business logic layer against real D1.

```typescript
// src/services/TenetsService.test.ts
import { env } from "cloudflare:workers";
import { tenetService } from "./TenetsService";

it("proposes a new tenet", async () => {
  const detail = await tenetService.propose(env.DB, 1, input);
  expect(detail.title).toBe("Use React");
});
```

**Setup:** `beforeAll` runs migrations, seeds a test user. Tests build on each other to share state.

**Scope:** Happy path for each method, authorization rules, business rule enforcement, error cases.

**Status:** ✅ 8 tests (propose, list, getBySlug, transition, vote, block validation, authz, accept)

---

#### 4. View/Component — JSX Render Tests

Server-side JSX renders to HTML strings. No DOM needed.

```typescript
// src/pages/Tenets/views/index.test.tsx
import { renderToString } from "hono/jsx/dom/server";
import { View } from "./index";

it("renders empty state when no tenets exist", () => {
  const html = renderToString(
    <View tenets={[]} currentUser={mockUser} />
  );
  expect(html).toContain("No tenets yet");
});
```

**CSS module handling:** The Workers pool doesn't handle `.module.css` imports natively. A vitest setup file stubs them:

```typescript
// vitest.setup.ts
import { vi } from "vitest";
vi.mock("*.module.css", () => new Proxy({}, {
  get: (_, key) => String(key),
}));
```

**Scope:** Each ViewModel state maps to correct rendered output — empty state, list, logged in/out, canVote/not, edge cases (nulls, empty arrays, long text).

**Status:** ⬜ Milestone 3 — needs CSS module shim first.

---

#### 5. Controller — HTTP Tests (Future)

End-to-end HTTP via `hono/testing`:

```typescript
import { testClient } from "hono/testing";
import controller from "../controller";

it("GET /tenets returns 200", async () => {
  const res = await testClient(controller._app).index.$get();
  expect(res.status).toBe(200);
});
```

**Scope:** Route existence, guard behavior (@Exists → 404, @Validate → 400), auth redirects.

**Note:** Controllers are thin wrappers over services + guards. Service tests cover most business logic, making controller tests a lower priority. Requires handling auth middleware in test setup.

**Status:** ⬜ Deferred — lower priority.

---

#### 6. Client Handlers (Future)

DOM interaction tests would need a DOM environment (happy-dom or Playwright). Handlers are thin wiring layers, making this the lowest priority.

**Status:** ⬜ Deferred — lowest priority.

---

### Test Execution

```bash
npm test          # Run all tests (watch mode)
npm run test:run  # Single run (CI)
```

### Current Coverage

| Layer | Test File | Status | Milestone |
|---|---|---|---|
| Request validation | `ProposeTenetRequest.test.ts`, `VoteRequest.test.ts` | ✅ 10 tests | 1 (done) |
| Service | `TenetsService.test.ts` | ✅ 8 tests | 2 (done) |
| Repository | `tenet/repo.test.ts`, `vote/repo.test.ts`, `user/repo.test.ts` | ⬜ Milestone 3 | 3 |
| View rendering | `index.test.tsx`, `show.test.tsx`, `new.test.tsx` | ⬜ Milestone 3 | 3 |
| Component rendering | `TenetCard`, `StatusBadge`, `UserAvatar` | ⬜ Milestone 3 | 3 |
| Controller HTTP | — | ⬜ Deferred | — |
| Client handlers | — | ⬜ Deferred | — |

### CI Setup

```yaml
# .github/workflows/ci.yml (future)
- run: npm ci
- run: cp wrangler.jsonc.example wrangler.jsonc
- run: npm run cf-typegen
- run: npm run test:run
```
