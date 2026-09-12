# Preprod circuit-call recording

This checklist is for recording real transactions. Automated browser tests use a fake connector only to exercise failure handling; their output is not evidence of Preprod circuit success.

## Prepare

- Run `npm ci`, then `npm run dev`. The dev/build lifecycle copies the checked-in compiled proving assets to the browser's public directory.
- Use Lace exposing dApp connector API 4 on Preprod, with usable DUST and a working proving provider configured in Lace. The app uses Lace's indexer and proving settings.
- Enter a strong private-state password, then connect. Keep the same browser profile, origin, wallet account, and password for subsequent sessions. The ownership secret is encrypted in browser storage; clearing that storage loses it. Never record secrets, passwords, wallet recovery phrases, or private-state exports.
- Wait for “Connected to verified contract.” The app verifies all three local verifier keys against the deployed contract before enabling calls. The round now comes from the indexer.

## Record an uninterrupted walkthrough

1. Show the app and Preprod wallet connection. Explain that the round is public and the ownership secret is private.
2. Call **Claim ownership**, approve Lace's prompts, and wait for “claim confirmed on-chain.” Show the returned transaction ID, block height, and contract address.
3. Call **Increment**, approve Lace, and wait for confirmation. Show the new round and its transaction ID/block height.
4. Call **Decrement**, approve Lace, and wait for confirmation. Show the changed round and its transaction ID/block height.
5. Reload the page, unlock with the same password, and reconnect. Show that the round is loaded from the chain. Increment again to demonstrate that the stored witness still authorizes calls after reload.
6. Cross-check the transaction IDs in Lace history or the network explorer. Capture the confirmed records as supporting evidence.

The deployed contract deliberately permits a subsequent claim to replace the owner. Describe it as a reclaimable demo, not permanent exclusive ownership. Changing that behavior requires a new contract deployment and matching compiled assets.

## Failure handling

A rejected prompt, proving error, wrong network, invalid witness, or failed chain execution must not produce a success receipt. If submission occurred but confirmation was interrupted, check Lace history before retrying; the transaction may already have landed. Another participant can reclaim the shared demo between calls.

## Evidence to attach

Publish the actual recording URL and list the public transaction IDs, blocks, network, and contract address below or in the submission. No successful Preprod recording has been produced by the automated checks in this repository.
