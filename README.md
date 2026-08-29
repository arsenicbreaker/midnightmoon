<div align="center">
  <h1>🌙 Midnight Private Counter</h1>

  <p>
    <strong>
      A privacy-preserving Midnight counter dApp that proves ownership before changing public counter state.
    </strong>
  </p>

  <p>
    <img
      src="https://img.shields.io/badge/Network-Midnight%20Preprod-6C63FF"
      alt="Midnight Preprod"
    />
    <img
      src="https://img.shields.io/badge/Smart%20Contract-Compact-8B5CF6"
      alt="Compact"
    />
    <img
      src="https://img.shields.io/badge/Frontend-React%20%2B%20Vite-61DAFB"
      alt="React and Vite"
    />
    <img
      src="https://img.shields.io/badge/Wallet-Lace-7C3AED"
      alt="Lace Wallet"
    />
    <img
      src="https://img.shields.io/badge/Privacy-Zero--Knowledge-111827"
      alt="Zero-Knowledge Privacy"
    />
  </p>
</div>

Midnight Private Counter is a privacy-preserving Midnight dApp that lets a user prove ownership of a counter before changing its public state. The counter value remains visible on-chain, while the authorization secret used to control it stays private.

---

Website: https://midnightmoon.vercel.app/

## Live Demo

https://midnightmoon.vercel.app/

## Contract Address

| Network | Address                                                            |
| ------- | ------------------------------------------------------------------ |
| Preprod | `4704d059a008791f2f6182d65ca6970c2b921b59f604186e4221dda326b68691` |

## What This Does

Midnight Private Counter is a small dApp that lets a user connect a Lace wallet, claim ownership of a counter contract, and then increment or decrement the public counter.

The counter value is visible on-chain, but the authorization secret used to control the counter stays private. Each protected action is backed by a zero-knowledge proof instead of revealing the raw private input.

## Privacy Model

* **What is PUBLIC:** The counter value, the owner commitment, contract address, transaction metadata, and state transitions recorded on the Midnight Preprod network.
* **What is PRIVATE:** The user's private witness input, including the secret key used to prove ownership. Private inputs must stay in local private state and must never appear in the UI.
* **What the user PROVES without revealing:** The user proves they know the private secret corresponding to the public owner commitment, allowing the contract to authorize `increment()` and `decrement()` without exposing that secret.

## Privacy Claim

An on-chain observer can see that a wallet submitted a transaction to the Preprod counter contract, which circuit was called, the public counter value, the owner commitment, and transaction metadata.

The observer cannot see the user's private secret key or the private witness input used to generate the proof.

## Tech Stack

| Technology      | Purpose                                   |
| --------------- | ----------------------------------------- |
| Midnight        | Privacy-preserving blockchain network     |
| Compact         | Smart contract and circuit language       |
| Midnight.js SDK | Midnight network and contract integration |
| React / Vite    | Frontend application                      |
| Lace Wallet     | Wallet connection and transaction signing |

## Prerequisites

* Lace wallet installed
* Node.js `v22`

## Run Locally

Clone the repository and enter the project directory:

```bash
git clone <repository-url>
cd midnightmoon
```

Install dependencies:

```bash
npm ci
```

Compile the Compact contract artifacts:

```bash
npm run compile
```

Create a local environment file that points the frontend at Preprod and the deployed contract:

```bash
printf 'VITE_MIDNIGHT_NETWORK_ID=preprod\nVITE_COUNTER_CONTRACT_ADDRESS=4704d059a008791f2f6182d65ca6970c2b921b59f604186e4221dda326b68691\n' > .env.local
```

Run the frontend:

```bash
npm run dev
```

Open the printed Vite URL in a browser with Lace installed, connect Lace on Preprod, and call the counter circuits from the app.

## Demo Video
https://www.youtube.com/watch?v=fe_xa_-ZH44
