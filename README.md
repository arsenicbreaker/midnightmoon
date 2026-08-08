# my-project

A Midnight Network **Compact** counter contract with room for a frontend (Level 2) and CI/CD (Level 3).

## Project layout

```
my-project/
├── contracts/
│   └── counter.compact      # Compact source
├── managed/                 # Output of `compact compile` (generated)
├── src/                     # Frontend (Level 2)
├── tests/
│   └── counter.test.ts      # Contract tests
├── .github/
│   └── workflows/           # CI/CD (Level 3)
├── README.md
└── package.json
```

| Path | Purpose |
|------|---------|
| `contracts/counter.compact` | On-chain counter: `increment` and `reset` circuits |
| `managed/` | Compiler artifacts (do not edit by hand) |
| `src/` | App/frontend code (added later) |
| `tests/` | Unit / integration tests |
| `.github/workflows/` | GitHub Actions (added later) |

## Prerequisites

- **Node.js** ≥ 22
- **Compact compiler** (`compact` on your `PATH`)
- Optional: Docker (local proof server / devnet)

## Getting started

```bash
# Install deps
npm install

# Compile Compact → managed/counter
npm run compile

# Run tests
npm test
```

### Compile only

```bash
compact compile contracts/counter.compact managed/counter
```

## Contract overview

`contracts/counter.compact` exposes:

| Circuit | Behavior |
|---------|----------|
| `increment()` | Adds `1` to the public `round` counter |
| `reset()` | Decrements `round` back to zero |

Ledger state:

- `round: Counter` — public on-chain counter

## Scripts

| Command | Description |
|---------|-------------|
| `npm run compile` | Compile `counter.compact` into `managed/counter` |
| `npm test` | Run tests under `tests/` |
| `npm run clean` | Clear generated `managed/` output |

## Development roadmap

1. **Level 1 (this scaffold)** — Compact contract, tests, package layout  
2. **Level 2** — Frontend under `src/`  
3. **Level 3** — CI/CD under `.github/workflows/`  

## Related

- [Midnight docs](https://docs.midnight.network)
- Local demo scaffold (if present): `mn-demo/`

## License

MIT
