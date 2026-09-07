# Curtio Backend — Folder Structure Audit

**Date:** 2026-09-04  
**Scope:** Read-only structural review of `/home/muhammad-nabeel-asif/Desktop/Curtio-Backend`  
**Stack inferred from code (not docs):** Node.js CommonJS, Express 5, Mongoose 9, Socket.IO 4, Jest + Supertest. No TypeScript, no ESLint, no README.  
**Pattern in use:** Inconsistent layered MVC. URL features follow `routes → controllers → services → models`. Auth is a fat router with handlers inline. Billing/owner checks live under `config/` even though they query Mongo. The app is a single-package repo, not a monorepo.

No files were modified except this report.

---

## 1. Current Structure Overview

Walked the tree excluding `.git/`, `node_modules/`, and Husky internals. There is no `src/`, `dist/`, or `build/` directory. Application code sits at the repository root.

### Top-level folders and files

| Path | Purpose |
| :--- | :--- |
| `config/` | Mix of real config (`env.js`, `db.js`, `redirectTiming.js`) and domain services that query Mongo (`owners.js`, `premium.js`) |
| `controllers/` | HTTP handlers for short-link CRUD, public redirect, click tracking, and inline HTML pages |
| `middleware/` | Single JWT Bearer-token guard for REST |
| `models/` | Mongoose schemas: `User` (embeds all URLs + click logs), `Owner`, `Subscription` |
| `modules/` | Auth (and some account) routes **and** handlers in one file — the only occupant |
| `routes/` | Thin Express router for `/api/urls` only |
| `services/` | JWT issuance and the entire URL/analytics/campaign domain |
| `socket/` | Socket.IO init, JWT handshake auth, room join on connect |
| `tests/` | Three Supertest integration suites against a real MongoDB |
| `utils/` | OTP email + GeoIP / bot classification |
| `.github/workflows/` | GitHub Actions CI that starts Mongo 6 and runs Jest |
| `.husky/` | Pre-push hook that runs `npm test` |
| `server.js` | App bootstrap, CORS, per-request DB connect, several route handlers, Socket.IO start |
| `test-db.js` | One-off CLI script to prove Mongo connectivity |
| `generate-report.js` | Post-Jest report renderer (txt / md / html) |
| `vercel.json` | Vercel serverless entry: all traffic → `server.js` |
| `.gcloudignore` | GCP deploy exclude list (implies a second host) |
| `package.json` / `package-lock.json` | Dependencies and scripts |
| `.env` | Local secrets (gitignored, **not** tracked) |
| `.gitignore` | Ignores `.env`, `node_modules`, `*.log`, and `dict` |

### Full source tree (application + tests + scripts)

```
.
├── server.js                          160 lines
├── test-db.js                          12 lines
├── generate-report.js                 196 lines
├── package.json                        37 lines
├── vercel.json                         15 lines
├── config/
│   ├── db.js                           42 lines
│   ├── env.js                          15 lines
│   ├── owners.js                       23 lines
│   ├── premium.js                     194 lines
│   └── redirectTiming.js               25 lines
├── controllers/
│   └── url.controller.js              655 lines
├── middleware/
│   └── auth.middleware.js              26 lines
├── models/
│   ├── Owner.js                        15 lines
│   ├── Subscription.js                182 lines
│   └── User.js                        173 lines
├── modules/
│   └── auth.routes.js                 359 lines
├── routes/
│   └── url.routes.js                   15 lines
├── services/
│   ├── jwt.js                          42 lines
│   └── url.service.js                 804 lines
├── socket/
│   ├── index.js                        53 lines
│   ├── auth.js                         29 lines
│   └── events.js                       36 lines
├── tests/
│   ├── login.test.js                   98 lines
│   ├── register.test.js                63 lines
│   └── url.test.js                     99 lines
└── utils/
    ├── geoip.js                       270 lines
    └── otpGenrater.js                  54 lines
```

**Total application JS (excluding lockfile):** ~3,761 lines across 25 `.js` files.

### Stated vs actual architectural intent

| Source | What it claims / implies | What the code actually does |
| :--- | :--- | :--- |
| No README | Nothing documented | Conventions must be inferred from folders |
| `package.json` `"main": "index.js"` | Entry is `index.js` | `index.js` does not exist; `"start"` runs `server.js` |
| Folder names `routes/`, `controllers/`, `services/`, `models/` | Classic Express layered MVC | Applied only to URLs. Auth skips controller + service |
| `config/premium.js` header | “the same shape as config/owners.js”; FastPay webhook later | This is a billing domain module (DB reads/writes), not configuration |
| `models/User.js:170` | “Store in Testing database → User collection” | Hard-wired collection name `"User"`; comment looks leftover from Atlas setup |
| `vercel.json` + `.gcloudignore` | Two deploy targets | Runtime is written for both long-lived Node **and** serverless (per-request `connectDB` in `server.js:40-48`) |

---

## 2. Strengths

1. **URL feature is actually layered.** `routes/url.routes.js` (15 lines) only binds verbs to `controllers/url.controller.js`, which mostly delegates persistence and quota checks to `services/url.service.js`. That is the right Express shape.

2. **Socket.IO is isolated.** `socket/index.js`, `socket/auth.js`, and `socket/events.js` have a clear init / auth / events split. REST and sockets both verify JWTs via `services/jwt.js`.

3. **Env loading is centralized (mostly).** `config/env.js` is the intended env object. `.env` is in `.gitignore` and is **not** in `git ls-files`.

4. **CI and a pre-push test hook exist.** `.github/workflows/ci.yml` (40 lines) runs `npm ci` + Jest against Mongo 6. `.husky/pre-push` runs `npm test`. That is more than many repos of this size have.

5. **Subscription access is derived, not a stored boolean.** `models/Subscription.js` + `config/premium.js` compute premium from `status` + `expiresAt`. Comments in those files are unusually precise about product rules (owner ≠ subscriber).

6. **Redirect timing is a single source of truth.** `config/redirectTiming.js` exports `REDIRECT_DELAY_MS` / `PRECLICK_WINDOW_MS` used by both the HTML loader (`controllers/url.controller.js:393`) and the in-memory pre-click window (`services/url.service.js:547`).

7. **Tests hit real HTTP routes.** `tests/login.test.js`, `tests/register.test.js`, and `tests/url.test.js` import `server.js` via Supertest and cover the happy/error paths for login, register, and basic URL CRUD.

---

## 3. TOP PRIORITY — Secrets, tokens, and data that must not leak

These are **not** structural nits. They are security findings discovered while mapping files.

### 3.1 No hardcoded cloud credentials in tracked source (good)

A scan of tracked `.js` / `.yml` found **no** committed Mongo connection strings, JWT secrets, Gmail app passwords, or API keys. Local `.env` (8 lines) is gitignored and untracked. Keys present locally: `PORT`, `EMAIL_USER`, `EMAIL_PASS`, `DB_URL`, `JWT_SECRET`, `CORS_ORIGIN`, `FRONT_END_URL`. `BACK_END_URL` is read in code (`controllers/url.controller.js:162`) but is not in the local `.env`.

### 3.2 OTP codes written to stdout in production-capable handlers

`modules/auth.routes.js:60` and `modules/auth.routes.js:265` log:

```
🔑 [DEV ONLY] Registration OTP for ${email} is: ${otp}
🔑 [DEV ONLY] Reset OTP for ${email} is: ${otp}
```

These run on every register / reset, not behind `NODE_ENV === "development"`. On Vercel / Cloud Run those lines become platform logs. That is a live secret leak.

### 3.3 Unauthenticated email-send endpoint with a hardcoded personal address

`modules/auth.routes.js:178-187` — `GET /api/auth/test-email` is mounted with the rest of `/api/auth` (no `authMiddleware`). It sends a real OTP email to `mrabdullahamjid33@gmail.com`. Anyone who can reach the API can trigger SMTP and confirm mail works. That is an open relay / harassment / cost vector.

### 3.4 Login 500 responses include the stack trace

`modules/auth.routes.js:170`:

```js
res.status(500).json({ success: false, message: error.message, stack: error.stack });
```

This is the only auth handler that returns `stack`. It exposes file paths and internals to clients.

### 3.5 Link passwords stored in plaintext

`models/User.js:23-26` and `services/url.service.js:154` persist `url.password` as a raw string. Account passwords are bcrypt-hashed (`modules/auth.routes.js:35`); link passwords are not. Anyone with DB read access (or a leaked `GET /api/urls` payload — `getMyUrls` does not strip `password`) can read them. `controllers/url.controller.js:44-51` strips `preClicks` / `preClickLogs` for non-owners but **does not** strip `password`.

### 3.6 OTP is stored and compared in plaintext

`models/User.js:142-148` and `modules/auth.routes.js:100` / `:285` compare `user.otp !== otp` in the clear. Combined with the console.log in 3.2, OTPs are easy to recover from logs or a DB dump.

---

## 4. Gaps & Issues

Grouped by theme. Paths are exact.

### 4.1 Inconsistent architecture (the main structural problem)

The repo **looks** like layered MVC. It is only layered for URLs.

| Concern | URL feature | Auth / account feature |
| :--- | :--- | :--- |
| Router | `routes/url.routes.js` | `modules/auth.routes.js` |
| Controller | `controllers/url.controller.js` | **None** — handlers are inside the router |
| Service | `services/url.service.js` | **None** — bcrypt, User I/O, OTP, Google fetch all in the router |
| Mounted from | `server.js:113` | `server.js:56` |

`modules/` contains one file and is not a module system. Labels (`PUT /api/auth/labels`, `modules/auth.routes.js:336-357`) are account data living on the auth router. Plan status (`GET /api/plan`) lives in `server.js:71-110`, not in either feature.

`config/` is overloaded:

| File | What it actually is |
| :--- | :--- |
| `config/env.js` | Config |
| `config/db.js` | Infrastructure (plus a one-off index migration) |
| `config/redirectTiming.js` | Config constants |
| `config/owners.js` | Domain query (`Owner.findOne`) |
| `config/premium.js` (194 lines) | Billing domain: `isPremium`, `hasUnlimitedLinks`, `activateSubscription`, hardcoded $10 / $96 |

New contributors will put the next feature in whichever folder they saw last — `modules/`, `server.js`, or `config/`.

### 4.2 God files (too many responsibilities)

| File | Lines | What it is doing at once |
| :--- | ---: | :--- |
| `services/url.service.js` | 804 | Short-code generation, URL validation, plan quota, password grants (JWT), UA/source detection, bot filter, click + pre-click tracking, in-memory visit Map, GeoIP, Socket.IO emit, campaign rename/delete (including regex mutation of `originalUrl`) |
| `controllers/url.controller.js` | 655 | CRUD handlers **plus** two full HTML documents (`buildRedirectPage` ~300–398, `buildLinkDisabledPage` ~400–561) **plus** public track/verify/redirect |
| `modules/auth.routes.js` | 359 | Register, OTP verify, login, Google OAuth, password reset, profile patch, labels, plus a public test-email route |
| `utils/geoip.js` | 270 | Private-IP check, datacenter ASN cache (fetches GitHub raw), ipapi.is, freeipapi fallback, partial country dictionary |
| `config/premium.js` | 194 | Quota constants **and** subscription CRUD (`activateSubscription` at line 145) |
| `server.js` | 160 | Express app, CORS, serverless DB middleware, health, dashboard stub, **plan aggregation**, public URL mounts, Socket.IO listen |
| `generate-report.js` | 196 | Three report formats inlined; belongs under `scripts/` |
| `models/User.js` | 173 | User identity **and** the entire `urlSchema` (clicks, pre-clicks, campaigns, labels) |
| `models/Subscription.js` | 182 | Schema **and** a boot-time TTL index drop (`dropExpiryTtlIndex`, lines 158–179) |

Threshold used here: anything over ~200 lines that mixes 3+ concerns.

### 4.3 Naming inconsistencies and typos

| Location | Issue |
| :--- | :--- |
| `utils/otpGenrater.js` | Filename typo: **Genrater** |
| `config/env.js:9` | `AppPassward` (password misspelled); used in `utils/otpGenrater.js:9` |
| `config/env.js:8-11` | Mixed casings: `AppEmail`, `AppPassward` vs `DB_URL`, `JWT_SECRET` |
| Auth JSON | `apiToken` + `LoginUser` (`modules/auth.routes.js:122-123`) — `LoginUser` is PascalCase for a field |
| `services/jwt.js:8` vs `:31` | Comment says token “Expires in 7 days”; code uses `{ expiresIn: "10d" }` |
| `package.json:5` | `"main": "index.js"` but there is no `index.js` |
| `package.json:2` | `"name": "backend"` — not `curtio-backend` |
| Response shapes | Auth uses `LoginUser`; URLs use `url` / `urls`; plan uses flat flags |
| Collection names | `"User"` (PascalCase, `models/User.js:171`) vs `"owners"` vs `"subscriptions"` |
| Folders | `modules/` vs `routes/` for the same kind of file |

### 4.4 Source / tests / config / scripts / docs boundary is weak

| Expected bucket | What exists | Problem |
| :--- | :--- | :--- |
| Source | Root-level `server.js` + feature folders | No `src/` boundary |
| Scripts | `test-db.js`, `generate-report.js` at repo root | Look like app entrypoints; `test-db.js` is not in `package.json` scripts |
| Tests | `tests/*.test.js` | No `jest.config.js`; no unit tests beside HTTP suites |
| Docs | **None** | No `README.md`, `CONTRIBUTING.md`, or `docs/` |
| Config | Root `vercel.json`, `.gcloudignore`, `.github/` | Fine; env documentation missing |
| Generated output | `generate-report.js` writes `test-report.json`, `test-report.txt`, `test-report.html`, `TEST_REPORT.md`, `reports/` | None of these are in `.gitignore` (only `*.log`, `.env`, `node_modules`, `dict`) |

`.gitignore` is 4 lines. A `npm run test:report` would create committable artifacts at the repo root.

### 4.5 Cross-cutting concerns are duplicated or split

**JWT secret access**

- `services/jwt.js:30` uses `env.JWT_SECRET` from `config/env.js`
- `services/url.service.js:24` and `:32` use `process.env.JWT_SECRET` directly for password grants

Two ways to read the same secret.

**dotenv is loaded twice**

- `server.js:6` — `dotenv.config()`
- `config/env.js:4` — `dotenv.config({ path: path.resolve(__dirname, "../.env") })`

**CORS origin parsing is copied**

- `server.js:27-29`
- `socket/index.js:15-17`

**Campaign name extraction is copied**

- `server.js:81-93` (plan endpoint Set of campaign names)
- `services/url.service.js:137-146` (on create)
- `services/url.service.js:688-718` / `:744-778` (rename / delete, including a second regex fallback)

**Owner / premium email match is inconsistent**

- `config/premium.js:32-38` escapes regex metacharacters
- `config/owners.js:13-15` interpolates `cleanEmail` into `new RegExp(\`^${cleanEmail}$\`, "i")` **without** `escapeRegex`

**`isOwner` is called from six places** (`modules/auth.routes.js`, `controllers/url.controller.js`, `config/premium.js`, `services/jwt.js`, `services/url.service.js`) instead of one authorization helper.

**Frontend / backend base URLs** are not in `config/env.js`. `FRONT_END_URL` and `BACK_END_URL` are read ad hoc in `controllers/url.controller.js:114` and `:162`. Local `.env` has `FRONT_END_URL` but not `BACK_END_URL`.

### 4.6 Missing standard files

| File | Status |
| :--- | :--- |
| `README.md` | **Missing** — no clone / env / run / test / deploy instructions |
| `.env.example` | **Missing** — env keys must be reverse-engineered from `config/env.js` + `process.env.*` |
| `CONTRIBUTING.md` | **Missing** |
| ESLint / Prettier / EditorConfig | **Missing** |
| `jest.config.js` | **Missing** (Jest defaults work because files are named `*.test.js`) |
| `Dockerfile` / `docker-compose.yml` | **Missing** |
| `index.js` | Referenced by `package.json` `"main"`, **does not exist** |

CI exists (`.github/workflows/ci.yml`). There is no lint job, no typecheck, and no deploy workflow.

### 4.7 Dead code, unused dependencies, unused imports, unused exports

**Unused npm dependencies** (in `package.json`, never `require`d):

- `cookie-parser` (`package.json:19`) — no cookie session; auth is `Authorization: Bearer`
- `svg-captcha` (`package.json:27`) — `handleRedirect` comment at `controllers/url.controller.js:130` says “No captcha”; leftover

**Unused import**

- `utils/geoip.js:1` — `const dns = require("dns");` is never used

**Dynamic import of a package that is not in `package.json`**

- `modules/auth.routes.js:201-204` — `await import('node-fetch')` if `global.fetch` is missing. Node 20 (CI) has `fetch`. The fallback would throw `MODULE_NOT_FOUND` on older Node.

**Exports that nothing else imports**

- `config/premium.js` — `activateSubscription`, `periodEndFor`, `getSubscription` (the last is only used inside the same file; the first two are “for FastPay later”, `config/premium.js:142-144`)
- `utils/otpGenrater.js:54` — `transporter`
- `services/url.service.js:791` — `validateUrl` (only used inside the same file)

**Root scripts that are not wired**

- `test-db.js` is tracked but not listed in `package.json` `scripts`

**Commented leftover in the entrypoint**

- `server.js:151-153` — `// startServer();` and `// module.exports = app;`

### 4.8 Tests do not match the surface area

| Area | Covered? |
| :--- | :--- |
| `POST /api/auth/login` | Yes — `tests/login.test.js` |
| `POST /api/auth/register` | Yes — `tests/register.test.js` |
| `POST/GET/PATCH/DELETE /api/urls` (basic) | Yes — `tests/url.test.js` |
| `POST /api/auth/verify-otp` | No |
| `POST /api/auth/google` | No |
| `POST /api/auth/send-reset-otp`, `/reset-password` | No |
| `PATCH /api/auth/update-profile`, `PUT /api/auth/labels` | No |
| `GET /api/plan`, `GET /api/dashboard` | No |
| Public `/:shortCode`, `/api/track`, `/api/preclick`, `/api/public/verify` | No |
| Campaign rename/delete, custom alias, password links, expiry | No |
| Premium / owner quota | No |
| Socket.IO | No |

`tests/url.test.js:94-97` asserts the health check inside the URL suite. Tests talk to whatever `DB_URL` / `MONGO_URI` `config/env.js` resolves — in CI that is `curtio_test_db`; locally it is the developer’s `.env`. There is no `mongodb-memory-server` and no guard that refuses to run against a non-test database.

### 4.9 Data model will not scale with the product

`models/User.js:162` embeds `urls: [urlSchema]`. Each URL embeds `clickLogs[]` and `preClickLogs[]` (`models/User.js:43-115`). Every click does `User.findOne` + `user.save()` (`services/url.service.js:479-522`). That means:

- Document size grows without bound (16 MB Mongo limit).
- Two simultaneous clicks on different links of the same user race on the whole document.
- Listing links (`getUserUrls`) loads every log for every link.

This is the largest **scalability** issue in the repo. Folder structure cannot save it; the aggregate is wrong for a click-tracking product.

### 4.10 Serverless vs long-lived process mismatch

`vercel.json` routes everything through `server.js`. The same file:

- Connects Mongo on **every request** (`server.js:40-48`) for serverless
- Also `listen()`s and starts Socket.IO when `NODE_ENV !== "test"` (`server.js:156-158`)
- Keeps `pendingVisits` in a process-local `Map` (`services/url.service.js:399`, `:551`)

Password grants were deliberately made stateless JWTs (`services/url.service.js:14-16`) because in-memory state breaks across instances. Pre-click tracking still uses in-memory state. On Vercel, a pre-click and a click can land on different isolates and the visit is finalized as a bounce. Socket.IO on Vercel serverless is likewise unreliable without an adapter (none is configured in `socket/index.js`).

`.gcloudignore` excludes `tests`, `test-db.js`, `generate-report.js` — a Cloud Run / GCE style deploy would match Socket.IO + in-memory maps better than Vercel. **Which host is production is not recorded in-repo.**

### 4.11 Product-rule gap that lives in the wrong layer

`FREE_CAMPAIGN_LIMIT` is defined in `config/premium.js:29` and returned from `GET /api/plan` (`server.js:104`). Nothing in `services/url.service.js` (`updateUserUrlCampaigns`, `addShortUrl`) enforces it. Link quota **is** enforced (`services/url.service.js:111`). Campaign quota is UI-only unless the frontend blocks it. That is a missing domain check, not just a missing folder.

### 4.12 Google login is structurally incomplete vs email login

`modules/auth.routes.js:193-249` calls Google’s userinfo endpoint with a Bearer access token (not an ID-token `audience` verify). The success payload omits `isOwner` (`:243`) while login and verify-otp include it (`:123`, `:166`). There is no `services/auth.service.js` to keep those response shapes aligned.

---

## 5. Scalability & dependency direction

### Would this survive more features and more contributors?

**Not without collapsing.** At ~3.8k lines and two real features (auth, urls) the tree is already inconsistent. A payments webhook, a second analytics channel, or a second engineer adding “the next endpoint” has three equally plausible homes: `server.js`, `modules/`, or `config/`. `services/url.service.js` is already the default dumping ground (804 lines).

### Dependency graph (actual)

```
server.js
  ├─ config/env.js
  ├─ config/db.js ──► config/env.js
  │                    └─ (lazy) models/Subscription.js
  ├─ middleware/auth.middleware.js ──► services/jwt.js
  ├─ modules/auth.routes.js ──► models/User, config/owners, utils/otpGenrater, services/jwt
  ├─ routes/url.routes.js ──► controllers/url.controller.js
  │                              ├─ services/url.service.js
  │                              ├─ config/owners.js
  │                              └─ config/premium.js
  ├─ config/premium.js ──► models/Subscription, config/owners
  ├─ models/User.js
  └─ socket/index.js ──► socket/auth.js ──► services/jwt.js
                         socket/events.js

services/jwt.js ──► config/env, config/owners, config/premium
services/url.service.js ──► models/User, config/owners, config/premium,
                            config/redirectTiming
                         └─ (lazy) utils/geoip.js
                         └─ (lazy) socket/index.js   ← cycle risk
```

### Circular / unclear direction

| Edge | Risk |
| :--- | :--- |
| `services/url.service.js` → `socket` (`require("../socket")` at lines 451, 526) | **Latent cycle:** `server.js` loads `url.controller` → `url.service` at the top, then loads `socket` later (line 133). Today this works because the socket require is **lazy** (inside functions). A top-level `require("../socket")` in the service would cycle: `socket/index.js` → `socket/auth.js` → `services/jwt.js` → `config/premium.js` → `config/owners.js`, and `server.js` already pulled `url.service` before `initSocket`. |
| `config/db.js:32` → `models/Subscription.js` | Config/infra depending on a model. Lazy, so it boots, but `config/` is no longer a leaf. |
| `config/owners.js` / `config/premium.js` → models | Domain logic in the config layer. Dependents (`jwt`, `url.service`, `server.js`, auth routes) all import “config” for business rules. |
| `config/db.js` ↔ mongoose connection used everywhere | Fine; connection is a singleton flag (`isConnected`). |

There is **no current hard circular require** at load time. The direction is still wrong: `config` should not depend on `models`, and `services` should not know about Socket.IO. A better edge is `services` emits a domain event; `socket` subscribes.

### Contributor chaos points

1. Next billing endpoint will likely land in `config/premium.js` or `server.js` (that is where `activateSubscription` and `/api/plan` already are).
2. Next HTML page will be appended to `controllers/url.controller.js` (it already hosts two documents).
3. Next auth-adjacent setting (labels already did this) will grow `modules/auth.routes.js`.
4. Click-log growth will silently hit Mongo document limits with no collection split planned in the tree.

---

## 6. Recommended Changes

### 6.1 Quick wins (low risk, mechanical)

Do these without moving business logic.

1. **Add `README.md` and `.env.example`.** Document: Node 20, `npm i`, copy env, `npm run dev`, `npm test`, CI needs `JWT_SECRET`. List keys actually read in code: `PORT`, `EMAIL_USER`, `EMAIL_PASS`, `DB_URL` / `MONGO_URI`, `JWT_SECRET`, `CORS_ORIGIN`, `FRONT_END_URL`, `BACK_END_URL`, `NODE_ENV`.
2. **Fix `package.json` `"main"`** to `"server.js"` (or add a one-line `index.js` that re-exports). Today `"main": "index.js"` is false.
3. **Rename typos:** `utils/otpGenrater.js` → `otpGenerator.js`; `AppPassward` → `appPassword` (or `EMAIL_PASS` only). Update the two require sites.
4. **Delete or unexport dead surface:** drop `cookie-parser` and `svg-captcha` from `package.json`; remove unused `dns` import in `utils/geoip.js:1`; remove `GET /api/auth/test-email` (`modules/auth.routes.js:178-187`); delete commented lines `server.js:151-153`.
5. **Guard the OTP console.logs** — delete them, or wrap in `if (process.env.NODE_ENV === "development")`. Same file: `modules/auth.routes.js:60`, `:265`.
6. **Stop returning `error.stack`** on login (`modules/auth.routes.js:170`).
7. **Move root scripts** to `scripts/test-db.js` and `scripts/generate-report.js`; add `"db:ping": "node scripts/test-db.js"`. Expand `.gitignore` with `test-report.*`, `TEST_REPORT.md`, `reports/`.
8. **Put all env reads through `config/env.js`.** Add `CORS_ORIGIN`, `FRONT_END_URL`, `BACK_END_URL`. Change `services/url.service.js:24,32` to use `env.JWT_SECRET`.
9. **Align JWT comment** in `services/jwt.js:8` with `"10d"`, or change the expiry — they disagree today.
10. **Strip `password` from URL JSON** in `controllers/url.controller.js` `getMyUrls` (and any other list/get). Same place already strips pre-click fields.
11. **Add `escapeRegex` to `config/owners.js`** so it matches `config/premium.js:36-38`.
12. **Add `isOwner` to the Google login payload** (`modules/auth.routes.js:243`) so it matches login / verify-otp.

### 6.2 Larger refactors (do incrementally)

Do these as separate PRs. Do not big-bang move everything.

**R1 — Split the two god files without changing behavior**

- Extract `buildRedirectPage` / `buildLinkDisabledPage` from `controllers/url.controller.js` (lines 300–561) into `src/modules/urls/redirect-pages.js` (or `views/`).
- Extract from `services/url.service.js`:
  - source / UA / UTM maps → `analytics/source.js`
  - password grant helpers (lines 18–45) → `urls/password-grant.js`
  - `pendingVisits` + `trackClick` / `trackPreClick` / `finalizePreClick` → `analytics/tracking.js`
  - campaign rename/delete URL-string mutation → `urls/campaigns.js`

**R2 — Make auth match the URL layer**

- `modules/auth.routes.js` → `routes/auth.routes.js` + `controllers/auth.controller.js` + `services/auth.service.js`.
- Move `PUT /labels` off the auth router onto an account or labels router.
- Move `GET /api/plan` and `GET /api/dashboard` out of `server.js` into a small `routes/account.routes.js`.

**R3 — Stop treating domain as config**

- `config/owners.js` → `services/owners.js` (or `modules/owners/`)
- `config/premium.js` → `services/billing.js`
- Leave `config/` with `env.js`, `db.js`, `redirectTiming.js` only.

**R4 — Invert the service → socket dependency**

- `url.service` should not `require("../socket")`. Emit from a tiny `events` bus, or pass `getIO` in. That removes the latent cycle documented in §5.

**R5 — Break the User megadoc (required before traffic grows)**

- `urls` as their own collection (`shortCode` unique).
- `clickLogs` / `preClickLogs` as append-only collections (or a time-series / analytics store).
- Keep `User` for identity, OTP, labels map, bcrypt password.

This is a data migration, not a rename. Plan it separately.

**R6 — Decide the runtime**

- If production is **Cloud Run / a VM**: keep Socket.IO; add a Redis adapter when you have >1 instance; `pendingVisits` still needs Redis/TTL.
- If production is **Vercel**: Socket.IO and the in-memory Map will not work as written. Move realtime off-process; persist pending visits.

Record the choice in the README so the folder layout can match (e.g. no `socket/` on a serverless-only deploy).

**R7 — Enforce campaign quota in the service**

- `FREE_CAMPAIGN_LIMIT` is returned but not enforced. Add the check next to the link quota in `services/url.service.js` once campaign counting lives in one function (today it is reimplemented in `server.js:81-93`).

**R8 — Test pyramid**

- Add `jest.config.js` with an explicit `testEnvironment` and a Mongo URI override that refuses `NODE_ENV !== "test"` against the Atlas URI.
- Unit-test `getSource`, `validateUrl`, `escapeRegex`, `grantsAccess`, password-grant issue/verify — they are pure enough once extracted.
- Add request tests for verify-otp, reset, plan, redirect, track.

**R9 — Introduce `src/` once R1–R3 are done**

- One move PR: everything that is the app goes under `src/`. Update `vercel.json` `src`, `"start"`, and test requires. Do not combine with behavior changes.

---

## 7. Suggested Target Structure

Proposed after the incremental refactors above. Names match this product (auth, urls, billing, analytics), not a generic tutorial.

```
.
├── README.md
├── CONTRIBUTING.md
├── .env.example
├── package.json
├── vercel.json                    # only if Vercel remains a target
├── .github/workflows/ci.yml
├── src/
│   ├── server.js                  # listen + Socket.IO only
│   ├── app.js                     # Express app, middleware, mounts — what tests import
│   ├── config/
│   │   ├── env.js
│   │   ├── db.js
│   │   └── redirectTiming.js
│   ├── middleware/
│   │   └── auth.middleware.js
│   ├── models/
│   │   ├── User.js                # identity only, after R5
│   │   ├── Url.js
│   │   ├── ClickEvent.js
│   │   ├── Owner.js
│   │   └── Subscription.js
│   ├── modules/
│   │   ├── auth/
│   │   │   ├── auth.routes.js
│   │   │   ├── auth.controller.js
│   │   │   └── auth.service.js
│   │   ├── urls/
│   │   │   ├── url.routes.js
│   │   │   ├── url.controller.js
│   │   │   ├── url.service.js
│   │   │   ├── password-grant.js
│   │   │   └── campaigns.js
│   │   ├── billing/
│   │   │   ├── billing.routes.js  # /api/plan, future webhook
│   │   │   └── billing.service.js # today’s config/premium.js
│   │   └── owners/
│   │       └── owners.service.js  # today’s config/owners.js
│   ├── analytics/
│   │   ├── source.js
│   │   ├── tracking.js
│   │   └── geoip.js
│   ├── views/
│   │   ├── redirect-loader.js
│   │   └── link-unavailable.js
│   ├── socket/
│   │   ├── index.js
│   │   ├── auth.js
│   │   └── events.js
│   └── lib/
│       ├── jwt.js
│       └── mail/
│           └── otp.js
├── tests/
│   ├── helpers/
│   ├── auth/
│   ├── urls/
│   └── billing/
└── scripts/
    ├── test-db.js
    └── generate-report.js
```

**Why this shape for *this* stack:** Express + Mongoose codebases stay navigable when each feature owns `routes / controller / service` and shared infra (`config`, `middleware`, `lib`) is a leaf. Hybrid “feature folders + thin shared layer” matches how URLs already work and fixes how auth / plan / billing currently do not.

**What not to do:** Do not introduce a monorepo, TypeScript, or a full hexagonal ports/adapters rewrite until the User megadoc and serverless/socket question are decided. Those would multiply files without fixing the two things that will actually break in production.

---

## 8. Open Questions

Intent is unclear in these places. Listed instead of guessed.

1. **Which runtime is production?** Tracked `vercel.json` and `.gcloudignore` both exist. `server.js` is written for both. Socket.IO + `pendingVisits` only work on a sticky long-lived process. Which host should the folder layout optimize for?

2. **Why is auth in `modules/` and URLs in `routes/` + `controllers/`?** Is `modules/` a leftover from an abandoned feature-folder migration, or was auth intentionally kept “flat”?

3. **Is `activateSubscription` in `config/premium.js:145` waiting on FastPay, or abandoned?** Nothing imports it. Should a `modules/billing/` exist now, or only when the webhook lands?

4. **`models/User.js:170` says “Testing database → User collection.”** Is the Atlas collection name `"User"` a permanent constraint (do not rename), or leftover from early development?

5. **What is `dict` in `.gitignore`?** No `dict/` exists in the tree. Local GeoIP database? Accidental ignore?

6. **Are `cookie-parser` and `svg-captcha` planned, or leftovers?** Captcha is explicitly not used in `handleRedirect`. Cookie-parser is unused while auth is Bearer-only.

7. **Should `GET /api/auth/test-email` exist in any deployed environment?** If it is a local-only helper, it should not be registered when `NODE_ENV !== "development"`.

8. **Is `BACK_END_URL` required in production?** `controllers/url.controller.js:162` falls back to `""`, and the loader then uses `window.location.origin` (`:363`). That is correct for a dedicated redirect host and wrong if the API and redirect host differ and the env var is missing.

9. **Why does the health check say “Curtio Staging is Live!”** (`server.js:52`)? Is this repo staging-only, or is production branded as staging?

10. **Campaign limit:** is `FREE_CAMPAIGN_LIMIT` meant to be enforced on the server (it is not) or only displayed for the SPA?

11. **Google OAuth:** is the client sending an access token on purpose (userinfo) or was an ID-token verify never finished?

12. **Reports:** should `npm run test:report` output stay local-only (gitignore), or is `TEST_REPORT.md` intended to be committed?

13. **Husky:** only `pre-push` exists. Is a pre-commit lint hook intentionally absent because there is no linter yet?

---

## 9. Priority action plan

| Priority | Item | Type |
| ---: | :--- | :--- |
| P0 | Remove or env-guard OTP `console.log`s; remove public `/api/auth/test-email`; stop sending `error.stack` on login | Security |
| P0 | Stop returning plaintext link passwords on `GET /api/urls` | Security |
| P1 | Add `README.md` + `.env.example`; fix `"main"`; gitignore report artifacts | Docs / hygiene |
| P1 | Remove unused deps (`cookie-parser`, `svg-captcha`) and unused `dns` import | Hygiene |
| P1 | Centralize env (`FRONT_END_URL`, `BACK_END_URL`, `CORS_ORIGIN`, `JWT_SECRET`) in `config/env.js` | Structure |
| P2 | Extract HTML pages and analytics/source maps out of the two god files | Structure |
| P2 | Split auth into routes / controller / service; move `/api/plan` out of `server.js` | Structure |
| P2 | Move `owners.js` / `premium.js` out of `config/` | Structure |
| P2 | Enforce `FREE_CAMPAIGN_LIMIT` in one shared campaign helper (if product intent is server-side) | Correctness |
| P3 | Invert `url.service` → `socket` require | Dependencies |
| P3 | Decide Vercel vs Cloud Run; fix `pendingVisits` + Socket.IO for that choice | Runtime |
| P3 | Split `urls` / click logs out of the User document | Data model |
| P3 | Introduce `src/` and feature folders after the splits above | Structure |
| P3 | Expand tests to OTP, plan, redirect/track, quota | Quality |

---

*End of audit. Only this file was added.*
