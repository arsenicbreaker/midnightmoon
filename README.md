# Midnight Private Counter

> A privacy-preserving Midnight counter dApp that proves ownership before changing public counter state.

## Live Demo

https://midnightmoon.vercel.app/

## Contract Address

| Network | Address |
|---------|---------|
| Preprod | `4704d059a008791f2f6182d65ca6970c2b921b59f604186e4221dda326b68691` |

## What This Does

Midnight Private Counter is a small dApp that lets a user connect a Lace wallet, claim ownership of a counter contract, and then increment or decrement the public counter. The counter value is visible on-chain, but the authorization secret used to control the counter stays private. Each protected action is backed by a zero-knowledge proof instead of revealing the raw private input.

## Privacy Model

- **What is PUBLIC:** The counter value, the owner commitment, contract address, transaction metadata, and state transitions recorded on the Midnight Preprod network.
- **What is PRIVATE:** The user's private witness input, including the secret key used to prove ownership. Private inputs must stay in local private state and must never appear in the UI.
- **What the user PROVES without revealing:** The user proves they know the private secret corresponding to the public owner commitment, allowing the contract to authorize `increment()` and `decrement()` without exposing that secret.

## Privacy Claim

An on-chain observer can see that a wallet submitted a transaction to the Preprod counter contract, which circuit was called, the public counter value, the owner commitment, and transaction metadata. The observer cannot see the user's private secret key or the private witness input used to generate the proof.

## Tech Stack

- Midnight network
- Compact
- Midnight.js SDK
- React/Vite
- Lace wallet

## Prerequisites

- Lace wallet installed
- Node.js v22

## Run Locally

1. Clone the repository and enter the project directory:

   ```bash
   git clone <repository-url>
   cd midnightmoon
   ```

2. Install dependencies:

   ```bash
   npm ci
   ```

3. Compile the Compact contract artifacts:

   ```bash
   npm run compile
   ```

4. Create a local environment file that points the frontend at Preprod and your deployed contract:

   ```bash
   printf 'VITE_MIDNIGHT_NETWORK_ID=preprod\nVITE_COUNTER_CONTRACT_ADDRESS=4704d059a008791f2f6182d65ca6970c2b921b59f604186e4221dda326b68691\n' > .env.local
   ```

5. Run the frontend:

   ```bash
   npm run dev
   ```

6. Open the printed Vite URL in a browser with Lace installed, connect Lace on Preprod, and call the counter circuits from the app.

## Demo Video

[PLACEHOLDER — I will add the link after recording]
