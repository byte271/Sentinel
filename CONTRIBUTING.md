# Contributing to SENTINEL

Thanks for your interest in contributing. SENTINEL is a safety framework, so the
bar for correctness and clarity is high. This guide covers how to get set up,
the conventions we follow, and what we expect from a pull request.

## Getting Started

```bash
git clone <your-fork-url>
cd sentinel
npm install
npm run build   # tsc — must produce no type errors
npm test        # vitest — all tests must pass (currently 214)
```

Requirements:

- **Node.js 18+** (uses the built-in `crypto` and ES modules).
- **TypeScript 5.6+** (installed as a dev dependency).

## Project Layout

See the *Project Structure* section of the [README](./README.md). Each feature
lives in its own module directory with a barrel `index.ts` that re-exports the
public surface, and every public export is also re-exported from the top-level
`src/index.ts`.

## Development Workflow

1. **Create a branch** off the default branch.
2. **Write the code** following the conventions below.
3. **Add tests** in `tests/` — mirror the module name (e.g. `src/firewall/` →
   `tests/firewall.test.ts`). New behavior must be covered.
4. **Build and test**: `npm run build && npm test`. Both must be green.
5. **Update docs**: README and `CHANGELOG.md` for any user-facing change.
6. **Open a PR** with a clear description of the what and the why.

## Coding Conventions

- **TypeScript, strict.** No `any`. Do not reach for `getattr`/`setattr`-style
  escape hatches or unsafe casts — model the types properly.
- **Determinism first.** Detection and scoring logic should be deterministic and
  explainable (pure functions, regex, hashing) rather than opaque heuristics.
  Inject clocks and id/nonce generators so behavior is testable.
- **Dependency-light.** The runtime depends only on `chalk`, `commander`, and
  `uuid`. Prefer Node's built-in `crypto` over adding packages. Don't add a
  dependency without a strong reason.
- **Security primitives.** Compare secrets, signatures, and tokens with
  `crypto.timingSafeEqual`. Sign with HMAC-SHA256. Never log secrets.
- **Hash chains** must remain append-only and tamper-evident; if you touch one,
  add a test that proves tampering is detected.
- **ESM imports** use the `.js` extension on relative paths (e.g.
  `import { X } from './x.js'`) even though the source is `.ts` — required by the
  module resolution config.
- **Comments** are sparse and explain *why*, not *what*. Match the surrounding style.
- **Public exports** go through the module barrel and `src/index.ts`.

## Testing

- Framework: [Vitest](https://vitest.dev/). Run all tests with `npm test`, or a
  single file with `npx vitest run tests/<name>.test.ts`.
- Tests must be deterministic — no reliance on wall-clock timing or network.
  Pass explicit timestamps and injected generators where a module supports them.
- Cover the security-relevant paths: tampering detection, replay/nonce rejection,
  permission-escalation rejection, and graceful-vs-hard kill behavior.

## Commit & PR Guidelines

- Keep changes focused; one logical change per PR.
- Reference the feature or bug id where relevant (e.g. `F6`, `B4`).
- A PR should leave `npm run build` and `npm test` green.
- Describe user-facing changes in `CHANGELOG.md` under the appropriate heading.

## Reporting Security Issues

Please do **not** open public issues for vulnerabilities. See [SECURITY.md](./SECURITY.md).
