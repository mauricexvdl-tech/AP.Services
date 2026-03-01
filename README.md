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
│ • Bot CRUD  │ • Health     │ • X25519   │ • SDL Gen     │
│ • Escrow    │   polling    │   encrypt  │ • Deployment  │
│ • Tiers     │ • Failure    │ • AES-GCM  │   lifecycle   │
│ • Cooldown  │   detection  │ • RAM-only │ • mTLS certs  │
│             │ • Batching   │   decrypt  │ • Bid/Lease   │
└─────────────┴──────────────┴────────────┴───────────────┘
```

### Dual-Chain Architecture
- **Base Sepolia (L2):** Smart contract for bot registration, escrow deposits, and on-chain state
- **Akash Network (Cosmos):** Decentralized compute marketplace for deploying resurrected containers

---

## Packages

| Package | Description | Status |
|---------|-------------|--------|
| `@aporia/contracts` | Solidity smart contract (`AporiaRegistry`) on Base L2 | ✅ Deployed |
| `@aporia/heartbeat` | Health-check watchdog with async batch polling | ✅ Complete |
| `@aporia/secrets` | X25519 + AES-256-GCM encryption for env vars | ✅ Complete |
| `@aporia/orchestrator` | Resurrection engine: detects crash → decrypts → deploys | ✅ Core complete |
| `@aporia/deployer` | SDL generator for Akash compute tiers | ✅ Complete |
| `@aporia/cli` | CLI for `init`, `register`, `status`, `deposit`, `test-local` | ✅ Complete |
| `@aporia/webhooks` | Webhook notifications (Discord, Telegram, email) | ✅ Complete |
| `@aporia/gateway` | API gateway for external integrations | 🔧 In Progress |

---

## Hardware Tiers

| Tier | CPU | RAM | Storage | Use Case |
|------|-----|-----|---------|----------|
| **NANO** | 1 vCPU | 1 GB | 1 GB | Trading bots, simple agents |
| **LOGIC** | 2 vCPU | 4 GB | 2 GB | API agents, data processors |
| **EXPERT** | 4 vCPU | 8 GB | 5 GB | ML inference, heavy automation |

---

## Quick Start

```bash
# Install dependencies
npm install

# Build all packages
npm run build

# Run contract tests
npm run test:contracts

# Run local E2E demo
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
DEPLOYER_SECRET_KEY=...
```

---

## Current Status

### ✅ What Works
- **Smart Contract** — `AporiaRegistry` deployed on Base Sepolia with full CRUD, escrow, tier management, and cooldown logic
- **Heartbeat Monitor** — Async batch health-checking with configurable failure thresholds
- **Secret Management** — X25519/AES-GCM encryption with RAM-only decryption
- **CLI** — Full command suite: `init`, `register`, `status`, `deposit`, `test-local`
- **Orchestrator** — Crash detection → on-chain data fetch → decryption → deployment pipeline
- **Akash Backend** — Wallet setup, certificate broadcast, SDL generation — all working on testnet-8
- **Webhooks** — Configurable notifications for crash events

### 🔧 Akash Deployment — SDK Compatibility Issue (Blocker)

The `MsgCreateDeployment` transaction is rejected by testnet-8 due to a **protobuf encoder mismatch** in `@akashnetwork/akashjs@1.0.0`:

| Component | Library | Format |
|-----------|---------|--------|
| SDL Parser (`sdl.groups()`) | `protobufjs` | Long objects, Uint8Array vals |
| v1beta4 Encoder (registry) | `@bufbuild/protobuf` | BigInt, native numbers |

These two serialization formats are **incompatible**. The v1beta3 encoder works but the chain only accepts v1beta4 type URLs.

**Potential fixes:**
1. Use Akash CLI binary as subprocess (reliable, less elegant)
2. Wait for `@akashnetwork/chain-sdk` (the new unified SDK)
3. Manually bridge the protobuf formats
4. Use the Akash Console REST API as proxy

---

## Roadmap

### Phase 1: Foundation ✅
- [x] Smart contract with escrow, tiers, cooldown
- [x] Heartbeat watchdog with async batching
- [x] X25519 + AES-GCM secret management
- [x] CLI tool suite
- [x] Webhook notifications
- [x] Local E2E resurrection demo (`test-local`)

### Phase 2: Akash Integration 🔧 (Current)
- [x] AkashBackend class with full deployment lifecycle
- [x] mTLS certificate management
- [x] SDL generation per tier
- [x] Wallet + RPC connection to testnet-8
- [ ] **Fix protobuf v1beta3/v1beta4 encoder mismatch**
- [ ] Successful deployment on Akash testnet
- [ ] Bid polling + lease creation
- [ ] Manifest submission with env var injection
- [ ] End-to-end testnet resurrection

### Phase 3: Production Alpha
- [ ] Mainnet contract deployment (Base L2)
- [ ] Akash mainnet integration
- [ ] Multi-provider bid selection (cheapest + fastest)
- [ ] Monitoring dashboard
- [ ] Rate limiting and abuse prevention

### Phase 4: Scale
- [ ] Multi-chain support (Arbitrum, Optimism)
- [ ] Reputation attestations (Proof of Honesty)
- [ ] Auto-scaling based on load
- [ ] Plugin system for custom deployment backends
- [ ] Token economics and governance

---

## TODOs

### Critical (Blockers)
- [ ] Resolve Akash SDK protobuf compatibility (`@bufbuild` vs `protobufjs`)
- [ ] Successfully broadcast `MsgCreateDeployment` on testnet-8

### High Priority
- [ ] Add retry logic with exponential backoff for RPC calls
- [ ] Implement deployment cleanup (close old deployments)
- [ ] Add proper error recovery in the orchestrator loop
- [ ] Write unit tests for AkashBackend

### Medium Priority
- [ ] Gateway API package implementation
- [ ] CI/CD pipeline with GitHub Actions
- [ ] Docker Compose for local development
- [ ] Documentation site
- [ ] Contract verification on Basescan

### Nice to Have
- [ ] Web dashboard for bot management
- [ ] Telegram bot for status notifications
- [ ] Multi-region Akash provider selection
- [ ] Cost estimation before deployment

---

## Security Model

```
User's Machine                    Blockchain                    Akash Provider
┌──────────┐     encrypted      ┌──────────┐    mTLS only    ┌──────────┐
│ Env Vars │ ──────────────────►│ On-Chain  │                 │ Container│
│ (plain)  │  X25519+AES-GCM   │(ciphertext)│                │ (running)│
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

---

## Tech Stack

- **Smart Contracts:** Solidity + Hardhat (Base Sepolia L2)
- **Backend:** TypeScript + Node.js
- **Blockchain Interaction:** ethers.js (Base), @cosmjs (Akash)
- **Crypto:** tweetnacl (X25519), Web Crypto API (AES-256-GCM)
- **Akash SDK:** @akashnetwork/akashjs v1.0.0
- **Testing:** Mocha + Chai

---

## License

MIT

---

*Built with 🫀 by the APORIA team — because your bots deserve a second life.*
