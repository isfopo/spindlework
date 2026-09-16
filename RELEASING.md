# Releasing spindlework

Two GitHub Actions workflows drive the release process:

1. **`rc`** — automatic: every push to `develop` produces a versioned release candidate.
2. **`publish`** — manual: promotes a chosen RC to a stable release and publishes it to npm and JSR.

```
push to develop ──► rc.yml ──► GitHub prerelease  v0.0.0-rc.<run#>
                                    │
                      Actions → publish.yml (manual dispatch)
                                    │
                        v0.0.0  stable release + npm + JSR publish
                                        │
                    auto-bump base to 0.0.1 on develop
```

---

## 1. Release candidates — automatic

Triggered by any push to `develop` (`.github/workflows/rc.yml`):

1. `npm ci` and build the framework (`npm run build --workspace spindlework`)
2. Compute the RC version `BASE-rc.<N>` from `packages/package.json` — `BASE` is the current version with any prerelease suffix stripped, `<N>` is one past the number of existing `v<BASE>-rc.*` prereleases, so the RC counter **resets per version** (`0.1.0-rc.1`, `0.1.0-rc.2`, …)
3. Run the test suite — **non-blocking**: the 9 pre-existing failures (fiber schema, fabric scope IDs) are tracked separately and won't block an RC
4. `npm pack` → attach `spindlework-<rc>.tgz`
5. Create a GitHub **prerelease** tagged `v<rc>` (e.g. `v0.0.0-rc.5`), targeting the pushed commit

The RC version is **never committed** to `develop` — the tag and release carry it, while `packages/package.json` keeps the plain `BASE`. Each push to `develop` produces the next `BASE-rc.<N>`, so existing RCs are never overwritten (a concurrent push could pick the same `<N>`; re-running the workflow after it resolves is the recovery).

## 2. Promoting an RC — manual

Once an RC looks good, promote it:

1. **Actions → `publish` → Run workflow**
2. **`rc_version`** (required): the RC to promote, e.g. `0.0.0-rc.5` (must match an existing `v<rc>` tag)
3. **`final_version`** (optional): override the release version. Defaults to the RC's base — the version in `packages/package.json` at the RC commit (e.g. `0.0.0`).
4. **`bump`** (optional): the next-version increment applied to `develop` after a successful publish — `patch` (default), `minor`, `major`, or `none`.

What `.github/workflows/publish.yml` does:

1. Check out the RC tag (same code that was RC'd)
2. Resolve the final version and set it in both `packages/package.json` and `packages/jsr.json`
3. Build
4. **npm publish** — publishes `spindlework@<final>` as `latest` using the `NPM_TOKEN` repository secret
5. **JSR publish** — `npx jsr publish` from `packages/`, authenticating tokenlessly via OIDC (the `@isfopo/spindlework` package must be linked to this repo on jsr.io)
6. `npm pack` → attach the tarball to a stable GitHub **release** `v<final>` (e.g. `v0.0.0`) at the RC commit
7. **Auto-bump** — increments the base version (`patch`/`minor`/`major` per the `bump` input, `none` skips) in `packages/package.json` and `packages/jsr.json`, and pushes the bump commit to `develop`, so the next RC starts from the bumped version

The prerelease stays visible in the Releases **Prereleases** tab for reference.

## 3. Version policy

- `packages/package.json` (and `packages/jsr.json`, kept in sync) is the source of truth for the **next** release version.
- The base version auto-increments after every promotion (patch by default; pick `minor`/`major` via the `bump` input) — no manual version edits needed. Version bumps are committed to `develop` by the workflow.
- Follow semver: patch for fixes, minor for features, major for breaking changes (this repo prefers breaking changes over compatibility shims).
- Example flow with a future `0.1.0`:
  - `0.1.0` is promoted (npm + JSR) from `0.1.0-rc.N`
  - the workflow bumps the base to `0.1.1` on `develop`
  - next pushes produce `0.1.1-rc.1`, `0.1.1-rc.2`, …
  - promoting `0.1.1-rc.2` publishes `0.1.1` and bumps to `0.1.2`, and so on

## 4. Prerequisites

| Item | Status |
|---|---|
| Workflows on the default branch | Required — GitHub only runs workflows defined on `main`; merge after the feature branch lands |
| `NPM_TOKEN` repo secret | Required — npm publish authenticates with this; add an npm access token (Automation type) under repo Settings → Secrets → Actions |
| JSR package linked for OIDC | Required for `jsr publish` — create `@isfopo/spindlework` on jsr.io and link the `isfopo/spindlework` GitHub repo in its package settings; no JSR token needed |
| `develop` pushable by the workflow | Required for the auto-bump step — the default `GITHUB_TOKEN` can push unless `develop` has branch protection requiring PRs |
| Node 24 on CI | Matches local toolchain |

## 5. Workflow files

- `.github/workflows/rc.yml` — RC generation
- `.github/workflows/publish.yml` — manual promotion