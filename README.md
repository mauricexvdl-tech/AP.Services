# 🛡️ APORIA — Decentralized Resurrection Protocol

> **Dead Man's Switch for Autonomous Agents & Trading Bots**
>
> When your bot dies, APORIA brings it back — automatically, trustlessly, on decentralized infrastructure.

---

## What is APORIA?

APORIA is a **Web3 resurrection protocol** that monitors autonomous agents (trading bots, API agents, data pipelines) and automatically redeploys them on decentralized compute (Akash Network) when they crash — without human intervention.

**How it works:**
1. **Register** your bot on-chain (Base L2) with encrypted environment variables
2. **Deposit** escrow funds to cover resurrection costs
3. **APORIA monitors** your bot's health endpoint (`GET /aporia-health`)
4. **Bot dies?** → 3 missed heartbeats → APORIA decrypts your env vars in RAM, deploys a fresh container on Akash, injects secrets via mTLS, wipes from memory

**Zero-trust security:** Environment variables are encrypted client-side, stored on-chain as ciphertext, and only decrypted in RAM during deployment. Never written to disk or logs.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    APORIA Protocol                       │
├─────────────┬──────────────┬────────────┬───────────────┤
│  Registry   │  Heartbeat   │  Secrets   │  Orchestrator │
│  (Base L2)  │  (Watchdog)  │  (Crypto)  │  (Akash Net)  │
├─────────────┼──────────────┼────────────┼───────────────┤
│ • Bot CRUD  │ • Health     │ • X25519   │ • CLI-based   │
│ • Escrow    │   polling    │   encrypt  │ • BME (ACT)   │
│ • Tiers     │ • Failure    │ • NaCl box │ • SDL Gen     │
│ • Cooldown  │   detection  │ • RAM-only │ • mTLS certs  │
│             │ • Batching   │   decrypt  │ • Bid/Lease   │
└─────────────┴──────────────┴────────────┴───────────────┘
```

### Dual-Chain Architecture
- **Base Sepolia (L2):** Smart contract for bot registration, escrow deposits, and on-chain state
- **Akash Network (Cosmos):** Decentralized compute marketplace for deploying resurrected containers

### Akash Integration: CLI over SDK

We use the native `provider-services` CLI binary via child_process instead of the akashjs SDK. This is a deliberate engineering decision:

> akashjs@1.0.0 bundles two incompatible protobuf runtimes — the SDL parser uses `protobufjs` (Long objects) while the v1beta4 encoder uses `@bufbuild/protobuf` (BigInt). The native CLI binary embeds a single Go protobuf stack and guarantees 100% reliable TX encoding.

This approach was validated end-to-end on Akash **testnet-8** with TX Code 0.

---

## Packages

| Package | Description | Status |
|---------|-------------|--------|
| `@aporia/contracts` | Solidity smart contract (`AporiaRegistry`) on Base L2 | ✅ Deployed |
| `@aporia/heartbeat` | Health-check watchdog with async batch polling | ✅ Complete |
| `@aporia/secrets` | X25519 + NaCl box (XSalsa20-Poly1305) encryption | ✅ Complete |
| `@aporia/orchestrator` | 7-phase resurrection engine (detect → decrypt → deploy → settle) | ✅ Complete |
| `@aporia/deployer` | SDL generator for Akash compute tiers | ✅ Complete |
| `@aporia/cli` | CLI for `init`, `register`, `status`, `deposit`, `test-local` | ✅ Complete |
| `@aporia/webhooks` | Webhook notifications (Discord, Telegram, email) | ✅ Complete |
| `@aporia/gateway` | API gateway for external integrations | 🔧 In Progress |

---

## Hardware Tiers

| Tier | CPU | RAM | Storage | Pricing | Use Case |
|------|-----|-----|---------|---------|----------|
| **NANO** | 1 vCPU | 1 GB | 1 GB | 100 uact/block | Trading bots, simple agents |
| **LOGIC** | 2 vCPU | 4 GB | 2 GB | 250 uact/block | API agents, data processors |
| **EXPERT** | 4 vCPU | 8 GB | 5 GB | 500 uact/block | ML inference, heavy automation |

> **Note:** Since the Akash BME upgrade (Feb 2026), deployments are priced in **ACT** (denom: `uact`), a stable compute credit. AKT is auto-minted into ACT by the backend when needed.

---

## Quick Start

### Prerequisites

- **Node.js** v20+
- **WSL2** (Ubuntu) — required for Akash CLI binaries on Windows
- **`provider-services`** v0.10+ — Akash deployment lifecycle
- **`akash`** v2.1.0+ — BME minting (`tx bme mint-act`)

### Install & Build

```bash
# Install dependencies
npm install

# Build all packages
npm run build

# Run contract tests
npm run test:contracts

# Run local E2E demo (Docker backend)
npx ts-node packages/cli/src/commands/test-local.ts
```

### Environment Variables

```env
# Base Sepolia (L2)
DEPLOYER_PRIVATE_KEY=0x...
ALCHEMY_API_KEY=...

# Akash Network
AKASH_MNEMONIC="twelve word mnemonic phrase here"
AKASH_RPC_ENDPOINT=https://testnetrpc.akashnet.net:443

# Orchestrator
DEPLOYER_SECRET_KEY=...  # NaCl keypair secret (Base64)
```

---

## Current Status

### ✅ What Works
- **Smart Contract** — `AporiaRegistry` deployed on Base Sepolia with full CRUD, escrow, tier management, and cooldown logic
- **Heartbeat Monitor** — Async batch health-checking with configurable failure thresholds
- **Secret Management** — X25519 NaCl box encryption with ephemeral keys and RAM-only decryption
- **CLI** — Full command suite: `init`, `register`, `status`, `deposit`, `test-local`
- **Orchestrator** — 7-phase pipeline: trigger → verify → fetch → decrypt → build → deploy → settle
- **Akash Backend** — CLI-based deployment lifecycle on testnet-8:
  - ✅ Wallet import + balance query
  - ✅ Certificate publish
  - ✅ ACT minting from AKT (BME)
  - ✅ **Deployment creation (TX Code 0, DSEQ verified)**
  - ✅ Bid polling, lease creation, manifest sending
- **Webhooks** — Configurable notifications for crash events

### 🔧 In Progress
- Waiting for testnet-8 providers to come online for full bid→lease→service flow
- Gateway API package

---

## Roadmap

### Phase 1: Foundation ✅
- [x] Smart contract with escrow, tiers, cooldown
- [x] Heartbeat watchdog with async batching
- [x] X25519 + NaCl box secret management
- [x] CLI tool suite
- [x] Webhook notifications
- [x] Local E2E resurrection demo (`test-local`)

### Phase 2: Akash Integration ✅
- [x] AkashBackend class — CLI-based (bypasses SDK protobuf issues)
- [x] mTLS certificate management
- [x] SDL generation with ACT (uact) pricing per tier
- [x] BME: Auto-mint ACT from AKT during initialization
- [x] Deployment creation — validated on testnet-8 (TX Code 0)
- [x] Bid polling + lease creation + manifest submission
- [x] Storefront polish (Prettier, professional comments)

### Phase 3: Production Alpha (Next)
- [ ] End-to-end deployment on testnet with live provider
- [ ] Mainnet contract deployment (Base L2)
- [ ] Akash mainnet integration
- [ ] Multi-provider bid selection (cheapest + fastest)
- [ ] Monitoring dashboard

### Phase 4: Scale
- [ ] Multi-chain support (Arbitrum, Optimism)
- [ ] Reputation attestations (Proof of Honesty)
- [ ] Auto-scaling based on load
- [ ] Plugin system for custom deployment backends
- [ ] Token economics and governance

---

## Security Model

```
User's Machine                    Blockchain                    Akash Provider
┌──────────┐     encrypted      ┌──────────┐    mTLS only    ┌──────────┐
│ Env Vars │ ──────────────────►│ On-Chain  │                 │ Container│
│ (plain)  │  X25519 NaCl box   │(ciphertext)│                │ (running)│
└──────────┘                    └──────────┘                  └──────────┘
                                      │                             ▲
                                      │ fetch+decrypt               │
                                      ▼ (RAM only)                  │
                                ┌──────────┐    inject via    ──────┘
                                │Orchestrator│   mTLS manifest
                                │ (in RAM)  │   (then wipe)
                                └──────────┘
```

- **Never on disk:** Env vars exist in plaintext only in RAM during the mTLS manifest push
- **Never logged:** All secret values are redacted from console output
- **Wiped after use:** Memory is zeroed immediately after manifest submission
- **Mnemonic security:** Akash wallet mnemonic is written to a temp file (mode 0600) for CLI import, then immediately deleted — never passed as a CLI argument (visible in `/proc/cmdline`)

---

## Tech Stack

- **Smart Contracts:** Solidity + Hardhat (Base Sepolia L2)
- **Backend:** TypeScript + Node.js (monorepo)
- **Base L2 Interaction:** ethers.js v6
- **Akash Interaction:** Native `provider-services` + `akash` CLI binaries via child_process
- **Crypto:** tweetnacl (X25519-XSalsa20-Poly1305)
- **Formatting:** Prettier
- **Testing:** Vitest

---

## License

MIT

---

*Built with 🫀 by the APORIA team — because your bots deserve a second life.*
