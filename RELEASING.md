# Releasing spindlework

Two GitHub Actions workflows drive the release process:

1. **`rc`** — automatic: every push to `develop` produces a versioned release candidate.
2. **`publish`** — manual: promotes a chosen RC to a stable release and publishes it to npm.

```
push to develop ──► rc.yml ──► GitHub prerelease  v0.0.0-rc.<run#>
                                    │
                      Actions → publish.yml (manual dispatch)
                                    │
                        v0.0.0  stable release + npm publish
```

---

## 1. Release candidates — automatic

Triggered by any push to `develop` (`.github/workflows/rc.yml`):

1. `npm ci` and build the framework (`npm run build --workspace spindlework`)
2. Compute the RC version `BASE-rc.<run#>` from `packages/package.json` — `BASE` is the current version with any prerelease suffix stripped, `<run#>` is the GitHub run number (unique per workflow, so RC versions never collide)
3. Run the test suite — **non-blocking**: the 9 pre-existing failures (fiber schema, fabric scope IDs) are tracked separately and won't block an RC
4. `npm pack` → attach `spindlework-<rc>.tgz`
5. Create a GitHub **prerelease** tagged `v<rc>` (e.g. `v0.0.0-rc.5`), targeting the pushed commit

The RC version is **never committed** to `develop` — the tag and release carry it, while `packages/package.json` keeps the plain `BASE`. Re-running the workflow produces a new run number, so existing RCs are never overwritten.

## 2. Promoting an RC — manual

Once an RC looks good, promote it:

1. **Actions → `publish` → Run workflow**
2. **`rc_version`** (required): the RC to promote, e.g. `0.0.0-rc.5` (must match an existing `v<rc>` tag)
3. **`final_version`** (optional): override the release version. Defaults to the RC's base — the version in `packages/package.json` at the RC commit (e.g. `0.0.0`).

What `.github/workflows/publish.yml` does:

1. Check out the RC tag (same code that was RC'd)
2. Resolve the final version, set it in `packages/package.json`
3. Build, then `npm pack`
4. **npm publish** — publishes `spindlework@<final>` as `latest` using the `NPM_TOKEN` repository secret
5. Create a stable GitHub **release** `v<final>` (e.g. `v0.0.0`) at the RC commit

The prerelease stays visible in the Releases **Prereleases** tab for reference.

## 3. Version policy

- `packages/package.json` is the single source of truth for the **next** release version.
- Bump it on `develop` before you want a release: RCs become `BASE-rc.<run#>`, and promotion publishes exactly `BASE`.
- Follow semver: patch for fixes, minor for features, major for breaking changes (this repo prefers breaking changes over compatibility shims).
- Example flow with a future `0.1.0`:
  - bump base to `0.1.0` on develop
  - pushes produce `0.1.0-rc.1`, `0.1.0-rc.2`, …
  - promoting `0.1.0-rc.2` publishes `0.1.0`

## 4. Prerequisites

| Item | Status |
|---|---|
| Workflows on the default branch | Required — GitHub only runs workflows defined on `main`; merge after the feature branch lands |
| `NPM_TOKEN` repo secret | Required — npm publish authenticates with this; add an npm access token (Automation type) under repo Settings → Secrets → Actions |
| Node 24 on CI | Matches local toolchain |

## 5. Workflow files

- `.github/workflows/rc.yml` — RC generation
- `.github/workflows/publish.yml` — manual promotion