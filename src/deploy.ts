/**
 * Deploy the counter contract to a Midnight network
 * (default: undeployed; use --network preview|preprod for public networks).
 *
 * Non-interactive: npm run deploy -- --network preview
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { resolveNetwork, getOrCreateWallet, formatWalletBackupNotice, recordDeployment } from './network';
import { createWallet, persistWalletState, unshieldedToken, type WalletContext } from './wallet';
import { createCounterPrivateState, witnesses } from './witnesses';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocket } from 'ws';
import * as Rx from 'rxjs';
import { randomBytes } from 'node:crypto';

// Midnight SDK imports
import { deployContract } from '@midnight-ntwrk/midnight-js-contracts';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import { DustAddress, MidnightBech32m } from '@midnight-ntwrk/wallet-sdk-address-format';
import { getNetworkId } from '@midnight-ntwrk/midnight-js-network-id';

// @ts-expect-error Required for wallet sync
globalThis.WebSocket = WebSocket;

// Identifier under which this contract's private state is stored.
const PRIVATE_STATE_ID = 'counterPrivateState';

// ─── Network configuration ─────────────────────────────────────────────────────
//
// Resolved from --network flag, .midnight-state.json, or defaulting to
// 'undeployed' (local devnet). Switch networks with: npm run network <name>

const { network, config: networkConfig } = resolveNetwork();
const WALLET = getOrCreateWallet(network);
const SEED = WALLET.seed;
{
  const notice = formatWalletBackupNotice(WALLET, network);
  if (notice) console.log(notice);
}

// ─── Proof server readiness ────────────────────────────────────────────────────
//
// The proof-server image is distroless and has no shell, so it can't run a
// container-side healthcheck. Poll it from the host before we submit anything
// that needs proofs.

async function waitForProofServer(maxAttempts = 60, delayMs = 2000): Promise<boolean> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await fetch(networkConfig.proofServer, {
        method: 'GET',
        signal: AbortSignal.timeout(3000),
      });
      return true;
    } catch (err: any) {
      const code = err?.cause?.code || err?.code || '';
      if (code !== 'ECONNREFUSED' && code !== 'UND_ERR_CONNECT_TIMEOUT' && code !== 'UND_ERR_SOCKET') {
        return true;
      }
    }
    if (attempt < maxAttempts) {
      process.stdout.write(`\r  Waiting for proof server... (${attempt}/${maxAttempts})   `);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  return false;
}

async function withTimeout<T>(label: string, timeoutMs: number, work: Promise<T>): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function waitForDeployWalletState(walletCtx: WalletContext) {
  const timeoutMs = Number(process.env.MIDNIGHT_WALLET_SYNC_TIMEOUT_MS || 900_000);
  const startedAt = Date.now();
  let synced = false;
  const syncInterval = setInterval(() => {
    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    process.stdout.write(`\r  ⏳ Syncing deploy wallet state... (${elapsed}s elapsed)   `);
  }, 5000);

  try {
    const [unshielded, dust] = await Promise.race([
      Promise.all([
        walletCtx.wallet.unshielded.waitForSyncedState(),
        walletCtx.wallet.dust.waitForSyncedState(),
      ]),
      new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(
            new Error(
              `Wallet sync timed out after ${Math.round(timeoutMs / 1000)}s. ` +
                'Preprod is reachable, but this wallet did not finish unshielded/DUST sync. ' +
                'Retry after funding the wallet, or increase MIDNIGHT_WALLET_SYNC_TIMEOUT_MS.',
            ),
          );
        }, timeoutMs);
      }),
    ]);

    synced = true;
    return { unshielded, dust };
  } finally {
    clearInterval(syncInterval);
    if (synced) {
      process.stdout.write('\r  ✓ Deploy wallet state synced.                              \n');
    } else {
      process.stdout.write('\r  ✗ Deploy wallet state did not finish syncing.              \n');
    }
  }
}

async function waitForFundedUnshieldedState(walletCtx: WalletContext) {
  const rawTimeout = Number(process.env.MIDNIGHT_PUBLIC_WALLET_SYNC_TIMEOUT_MS || process.env.MIDNIGHT_WALLET_SYNC_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(rawTimeout) && rawTimeout > 0 ? rawTimeout : 120_000;
  const startedAt = Date.now();
  let lastBalance = 0n;
  let lastProgress = '';
  let found = false;
  const syncInterval = setInterval(() => {
    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    process.stdout.write(
      `\r  ⏳ Waiting for funded unshielded wallet state... (${elapsed}s elapsed, ` +
        `balance ${lastBalance.toLocaleString()}${lastProgress ? `, ${lastProgress}` : ''})   `,
    );
  }, 5000);

  try {
    const state = await Promise.race([
      Rx.firstValueFrom(
        walletCtx.wallet.state().pipe(
          Rx.tap((s) => {
            lastBalance = s.unshielded.balances[unshieldedToken().raw] ?? 0n;
            const progress = s.unshielded.progress as {
              appliedId?: unknown;
              highestTransactionId?: unknown;
              isConnected?: unknown;
            };
            const applied = progress.appliedId ?? '?';
            const highest = progress.highestTransactionId ?? '?';
            lastProgress = `unshielded ${String(applied)}/${String(highest)}`;
          }),
          Rx.filter((s) => (s.unshielded.balances[unshieldedToken().raw] ?? 0n) > 0n),
        ),
      ),
      new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(
            new Error(
              `Unshielded wallet funding was not visible after ${Math.round(timeoutMs / 1000)}s. ` +
                'Fund the printed Preprod wallet address from the faucet and retry. ' +
                'If the wallet is already funded, run `npm run diagnose-wallet -- --network preprod`.',
            ),
          );
        }, timeoutMs);
      }),
    ]);

    found = true;
    return state;
  } finally {
    clearInterval(syncInterval);
    if (found) {
      process.stdout.write('\r  ✓ Funded unshielded wallet state found.                    \n');
    } else {
      process.stdout.write('\r  ✗ Funded unshielded wallet state was not found.            \n');
    }
  }
}

function progressValue(progress: unknown, field: 'appliedIndex' | 'highestRelevantWalletIndex'): bigint | null {
  const value = (progress as Record<string, unknown>)[field];
  if (value === undefined || value === null) return null;
  try {
    return BigInt(String(value));
  } catch {
    return null;
  }
}

async function waitForUsableDust(walletCtx: WalletContext) {
  const rawTimeout = Number(process.env.MIDNIGHT_DUST_SYNC_TIMEOUT_MS || process.env.MIDNIGHT_DUST_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(rawTimeout) && rawTimeout > 0
    ? rawTimeout
    : network === 'undeployed'
      ? 120_000
      : 24 * 60 * 60_000;
  const startedAt = Date.now();
  let lastDust = 0n;
  let firstApplied: bigint | null = null;
  let lastApplied: bigint | null = null;
  let lastHighest: bigint | null = null;

  const renderProgress = () => {
    const elapsedSec = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
    const remaining =
      lastApplied !== null && lastHighest !== null && lastHighest > lastApplied
        ? lastHighest - lastApplied
        : null;
    const rate =
      firstApplied !== null && lastApplied !== null && lastApplied > firstApplied
        ? Number(lastApplied - firstApplied) / elapsedSec
        : 0;
    const eta =
      remaining !== null && rate > 0
        ? `, eta ~${Math.max(1, Math.ceil(Number(remaining) / rate / 60))}m`
        : '';
    const progress =
      lastApplied !== null && lastHighest !== null
        ? `, dust sync ${lastApplied.toLocaleString()}/${lastHighest.toLocaleString()}`
        : '';
    process.stdout.write(
      `\r  ⏳ Waiting for usable DUST... (${elapsedSec}s elapsed, ` +
        `DUST ${lastDust.toLocaleString()}${progress}${eta})   `,
    );
  };

  const progressInterval = setInterval(renderProgress, 5000);
  try {
    const state = await Promise.race([
      Rx.firstValueFrom(
        walletCtx.wallet.state().pipe(
          Rx.tap((s) => {
            lastDust = s.dust.balance(new Date());
            lastApplied = progressValue(s.dust.progress, 'appliedIndex');
            if (firstApplied === null && lastApplied !== null) firstApplied = lastApplied;
            lastHighest = progressValue(s.dust.progress, 'highestRelevantWalletIndex');
          }),
          Rx.filter((s) => s.dust.balance(new Date()) > 0n),
        ),
      ),
      new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(
            new Error(
              `DUST stayed at 0 after ${Math.round(timeoutMs / 60_000)} min. ` +
                'Keep the sync running with `npm run deploy -- --network preprod`, or restore a wallet that already has DUST.',
            ),
          );
        }, timeoutMs);
      }),
    ]);
    process.stdout.write('\r  ✓ Usable DUST found.                                      \n');
    return state;
  } finally {
    clearInterval(progressInterval);
  }
}

// ─── Compiled contract loading ─────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Counter compile output lives at managed/counter (project root), not contracts/managed.
const zkConfigPath = path.resolve(__dirname, '..', 'managed', 'counter');
const contractPath = path.join(zkConfigPath, 'contract', 'index.js');

if (!fs.existsSync(contractPath)) {
  console.error('\n❌ Contract not compiled! Run: npm run compile\n');
  process.exit(1);
}

const CounterModule = await import(pathToFileURL(contractPath).href);

const compiledContract = CompiledContract.make('counter', CounterModule.Contract).pipe(
  CompiledContract.withWitnesses(witnesses as any),
  CompiledContract.withCompiledFileAssets(zkConfigPath),
);

// ─── Providers ─────────────────────────────────────────────────────────────────

async function createProviders(walletCtx: WalletContext) {
  // The SDK requires the private-state password to be at least 16 characters.
  // The default below is a placeholder for local devnet only — set a strong
  // password via PRIVATE_STATE_PASSWORD when you move to a non-local target.
  const privateStatePassword = process.env.PRIVATE_STATE_PASSWORD?.trim() || 'Local-Devnet-Development-Placeholder-1';

  const walletProvider = {
    // In Midnight.js 4.1.x the WalletProvider interface returns the key objects
    // (CoinPublicKey / EncPublicKey) directly — no longer hex strings.
    getCoinPublicKey: () => walletCtx.shieldedSecretKeys.coinPublicKey,
    getEncryptionPublicKey: () => walletCtx.shieldedSecretKeys.encryptionPublicKey,
    async balanceTx(tx: any, ttl?: Date) {
      // balanceUnboundTransaction -> finalizeRecipe is the complete balancing
      // path in wallet-sdk 1.x; the earlier explicit signRecipe step is gone.
      const recipe = await walletCtx.wallet.balanceUnboundTransaction(
        tx,
        { shieldedSecretKeys: walletCtx.shieldedSecretKeys, dustSecretKey: walletCtx.dustSecretKey },
        {
          ttl: ttl ?? new Date(Date.now() + 30 * 60 * 1000),
          tokenKindsToBalance: ['dust'],
        },
      );
      return walletCtx.wallet.finalizeRecipe(recipe);
    },
    submitTx: (tx: any) => walletCtx.wallet.submitTransaction(tx) as any,
  };

  const zkConfigProvider = new NodeZkConfigProvider(zkConfigPath);
  const accountId = walletCtx.unshieldedKeystore.getBech32Address().toString();

  return {
    privateStateProvider: levelPrivateStateProvider({
      privateStateStoreName: 'counter-state',
      accountId,
      privateStoragePasswordProvider: () => privateStatePassword,
    }),
    publicDataProvider: indexerPublicDataProvider(networkConfig.indexer, networkConfig.indexerWS),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(networkConfig.proofServer, zkConfigProvider),
    walletProvider,
    midnightProvider: walletProvider,
  };
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log(`║  Deploy counter to ${network}`);
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  console.log('─── Proof Server ───────────────────────────────────────────────\n');
  console.log('  Checking proof server...');
  const proofServerReadyBeforeSync = await waitForProofServer(5, 1000);
  if (!proofServerReadyBeforeSync) {
    console.log('\n  ❌ Proof server not responding at ' + networkConfig.proofServer);
    console.log('     Start it first, then re-run deploy.');
    console.log('     Usually: npm run proof-server:start\n');
    process.exit(1);
  }
  process.stdout.write('\r  Proof server ready!                                 \n\n');

  const seed = SEED;

  console.log('─── Wallet setup ───────────────────────────────────────────────\n');
  console.log('  Creating wallet...');
  const walletCtx = await createWallet({ network, networkConfig, seed });
  const persistInterval = setInterval(() => {
    persistWalletState(network, walletCtx).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`  ⚠ Periodic wallet state save failed (${msg}).\n`);
    });
  }, Number(process.env.MIDNIGHT_WALLET_SAVE_INTERVAL_MS || 30_000));
  const address = walletCtx.unshieldedKeystore.getBech32Address();
  console.log(`  Wallet Address: ${address}`);
  const restoredCount = Object.values(walletCtx.restored).filter(Boolean).length;
  if (restoredCount > 0) {
    console.log(`  Restored ${restoredCount}/3 child wallets from .midnight-wallet-state — sync will resume from saved point.`);
  }

  console.log('  Syncing with network...');
  console.log('  ℹ  This may take several minutes depending on network size.');
  console.log('     RPC disconnection messages during sync are normal and can be safely ignored.\n');
  const state = network === 'undeployed'
    ? await waitForDeployWalletState(walletCtx)
    : await waitForFundedUnshieldedState(walletCtx);

  let balance = state.unshielded.balances[unshieldedToken().raw] ?? 0n;
  console.log(`  Balance: ${balance.toLocaleString()} tNight\n`);

  // Persist any partial progress now so a later deploy failure doesn't waste
  // the unshielded scan work. Individual child serialization failures are
  // already logged and non-fatal.
  await persistWalletState(network, walletCtx);

  if (network === 'undeployed' && balance === 0n) {
    console.error(
      '\n❌ Genesis-seed wallet has zero NIGHT. The devnet preset may not have minted to it.\n' +
        '   Check `docker compose ps` and `docker compose logs node`. Then `docker compose down -v` and retry.\n',
    );
    clearInterval(persistInterval);
    await persistWalletState(network, walletCtx);
    await walletCtx.wallet.stop();
    process.exit(1);
  }

  // Faucet poll for public networks. The wallet has 0 tNIGHT until the user
  // funds the address from the network's faucet. The display balance is
  // authoritative here (unlike DUST, tNIGHT shows up immediately once the
  // faucet tx lands).
  if (network !== 'undeployed' && networkConfig.faucet) {
    // Same balance idiom used by check-balance.ts:
    //   state.unshielded.balances[unshieldedToken().raw] ?? 0n
    const initialTNight = balance;
    if (initialTNight === 0n) {
      console.log('─── Fund Wallet ────────────────────────────────────────────────\n');
      console.log(`  Wallet address: ${address}`);
      console.log(`  Faucet:         ${networkConfig.faucet}`);
      console.log('');
      console.log('  Waiting for tNIGHT to arrive (poll every 10s)...');
      const rawTimeout = Number(process.env.MIDNIGHT_FAUCET_TIMEOUT_MS);
      const timeoutMs = Number.isFinite(rawTimeout) && rawTimeout > 0 ? rawTimeout : 600_000;
      const start = Date.now();
      while (true) {
        await new Promise((r) => setTimeout(r, 10_000));
        const s = await Rx.firstValueFrom(walletCtx.wallet.state());
        const tn = s.unshielded.balances[unshieldedToken().raw] ?? 0n;
        if (tn > 0n) {
          console.log(`\n  Funded! tNIGHT balance: ${tn.toLocaleString()}\n`);
          break;
        }
        if (Date.now() - start > timeoutMs) {
          console.log(`\n  ❌ Funding not received within ${Math.round(timeoutMs / 60_000)} min.`);
          console.log(`  Address: ${address}`);
          console.log(`  Faucet:  ${networkConfig.faucet}`);
          console.log('  Re-run setup after funding — your seed is preserved.\n');
          clearInterval(persistInterval);
          await persistWalletState(network, walletCtx);
          await walletCtx.wallet.stop();
          process.exit(1);
        }
        const elapsed = Math.round((Date.now() - start) / 1000);
        process.stdout.write(`\r  ...still waiting (${elapsed}s elapsed)`);
      }
    }
  }

  // Register for DUST.
  // Preview/Preprod public RPCs sometimes close the WebSocket mid-submit with
  // "1000:: Normal Closure". Retry registration: the tx may have landed even
  // when the watch stream dies, so re-check UTXO flags between attempts.
  console.log('─── DUST Token Setup ───────────────────────────────────────────\n');
  const DUST_REG_MAX_ATTEMPTS = 8;
  const DUST_REG_RETRY_MS = 8000;

  for (let attempt = 1; attempt <= DUST_REG_MAX_ATTEMPTS; attempt++) {
    const dustState = await Rx.firstValueFrom(
      walletCtx.wallet.state().pipe(
        Rx.filter((s) => (s.unshielded.balances[unshieldedToken().raw] ?? 0n) > 0n),
      ),
    );
    const unregisteredUtxos = dustState.unshielded.availableCoins.filter(
      (c: any) => !c.meta?.registeredForDustGeneration,
    );

    if (unregisteredUtxos.length === 0) {
      if (attempt > 1) console.log('  NIGHT UTXOs already registered for DUST.\n');
      break;
    }

    console.log(
      `  Registering ${unregisteredUtxos.length} NIGHT UTXOs for DUST generation` +
        (attempt > 1 ? ` (retry ${attempt}/${DUST_REG_MAX_ATTEMPTS})` : '') +
        '...',
    );
    // The signDustRegistration callback (3rd arg) already produces a recipe
    // with N signatures matching N inputs. Do NOT call signRecipe again — that
    // would double-sign and the chain rejects with InputsSignaturesLengthMismatch
    // (Custom error 192). Matches upstream example-counter and example-bboard.
    try {
      const recipe = await walletCtx.wallet.registerNightUtxosForDustGeneration(
        unregisteredUtxos,
        walletCtx.unshieldedKeystore.getPublicKey(),
        (payload) => walletCtx.unshieldedKeystore.signData(payload),
        MidnightBech32m.parse(String(DustAddress.encodePublicKey(getNetworkId(), dustState.dust.publicKey))).decode(
          DustAddress,
          getNetworkId(),
        ),
      );
      const finalized = await walletCtx.wallet.finalizeRecipe(recipe);
      await withTimeout(
        'DUST registration submit',
        Number(process.env.MIDNIGHT_SUBMIT_TIMEOUT_MS || 60_000),
        walletCtx.wallet.submitTransaction(finalized) as Promise<unknown>,
      );
      break;
    } catch (err: any) {
      const msg = err?.message || String(err);
      const cause = err?.cause?.message || err?.cause?.cause?.message || '';
      const full = `${msg} ${cause}`;
      const isTransient =
        full.includes('disconnected') ||
        full.includes('SubmissionError') ||
        full.includes('Transaction submission') ||
        full.includes('DUST registration submit timed out') ||
        full.includes('Normal Closure') ||
        full.includes('WebSocket');

      if (!isTransient || attempt === DUST_REG_MAX_ATTEMPTS) {
        throw err;
      }
      console.log(
        `  ⚠ DUST registration submit interrupted (${cause || msg}). ` +
          `Waiting ${DUST_REG_RETRY_MS / 1000}s then re-checking...`,
      );
      await new Promise((r) => setTimeout(r, DUST_REG_RETRY_MS));
      // Give the wallet a moment to re-sync so registered flags can update
      // if the previous extrinsic actually landed.
      if (network === 'undeployed') {
        await waitForDeployWalletState(walletCtx);
      } else {
        await waitForFundedUnshieldedState(walletCtx);
      }
    }
  }

  {
    const currentState = await Rx.firstValueFrom(walletCtx.wallet.state());
    if (currentState.dust.balance(new Date()) === 0n) {
      const registeredUtxos = currentState.unshielded.availableCoins.filter(
        (c: any) => c.meta?.registeredForDustGeneration,
      );
      if (registeredUtxos.length > 0) {
        console.log('  NIGHT UTXOs are registered, but local DUST state has not caught up yet.');
        console.log('  Keeping the wallet open until DUST is usable. This can take a while on Preprod.\n');
        await waitForUsableDust(walletCtx);
      } else {
        console.log('  No DUST available yet; deploy will retry while DUST is generated.\n');
      }
    }
  }
  console.log('  DUST tokens ready!\n');

  // Deploy.
  console.log('─── Deploy Contract ────────────────────────────────────────────\n');

  console.log('  Setting up providers...');
  const providers = await createProviders(walletCtx);

  // The wallet's reported DUST balance is a *time-projection* of what its
  // registered NIGHT will eventually generate; the tx-builder spends only
  // what the next block's timestamp accounts for, which lags wall-clock by
  // ~1 block on a fresh devnet. Sleeping ~1 block-time before attempt 1
  // closes that gap in the common case; the retry loop covers outliers.
  process.stdout.write('  Generating DUST...');
  await new Promise((r) => setTimeout(r, 6000));
  process.stdout.write(' done.\n');

  console.log('  Deploying contract...\n');

  // Fallback timing. The 6s pre-pause above handles the common case; this
  // loop covers genuine outliers (slow blocks, proof-server worker-pool
  // settling). Earlier 2s retries caused CI flakes where attempt 2's /prove
  // hit the proof-server before it had drained attempt 1's state — 5s gives
  // it room to settle between attempts. 20 × 5 = 100s total budget.
  const MAX_RETRIES = 20;
  const RETRY_DELAY_MS = 5000;
  const DEPLOY_ATTEMPT_TIMEOUT_MS = Number(process.env.MIDNIGHT_DEPLOY_ATTEMPT_TIMEOUT_MS || 180_000);
  let deployed: Awaited<ReturnType<typeof deployContract>> | undefined;

  // Owner secret for the counter witness — generated once, reused across retries.
  const initialPrivateState = createCounterPrivateState(randomBytes(32));

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      // Midnight.js 4.1.x supplies private state via privateStateId +
      // initialPrivateState. Counter uses a secretKey witness for ownership.
      // args is empty (no constructor args). Explicit [] required for dynamic load.
      deployed = await withTimeout(
        'Contract deploy attempt',
        DEPLOY_ATTEMPT_TIMEOUT_MS,
        deployContract(providers, {
          compiledContract: compiledContract as any,
          args: [],
          privateStateId: PRIVATE_STATE_ID,
          initialPrivateState,
        }),
      );
      break;
    } catch (err: any) {
      const errMsg = err?.message || err?.toString() || '';
      const errCause = err?.cause?.message || err?.cause?.toString() || '';
      const fullError = `${errMsg} ${errCause}`;

      // DUST shortage is the most common transient failure on a fresh devnet —
      // check it BEFORE proof-server connectivity, because dust-balancing errors
      // can surface through proof-server-shaped messages (the wallet talks to
      // the proof-server while building the dust portion of the tx).
      const isDustShortage =
        fullError.includes('Not enough Dust') ||
        fullError.includes('Insufficient Funds') ||
        fullError.includes('could not balance dust') ||
        fullError.includes('Contract deploy attempt timed out');

      // Quiet the first DUST-shortage retry: it's the expected race between
      // wall-clock projection and block-timestamp accounting and the loud
      // `Insufficient Funds: <huge number>` message scares first-time users.
      // Real failures still get the full diagnostic from attempt 2 onward.
      if (!(isDustShortage && attempt === 1)) {
        console.error(`\n  Attempt ${attempt} error: ${errMsg}`);
        if (errCause && errCause !== errMsg) console.error(`  Cause: ${errCause}`);
      }

      if (
        !isDustShortage &&
        (fullError.includes('Failed to connect to Proof Server') ||
          fullError.includes('connect ECONNREFUSED 127.0.0.1:6300'))
      ) {
        console.log('  ❌ Proof server unreachable. Run: docker compose up -d\n');
        clearInterval(persistInterval);
        await persistWalletState(network, walletCtx);
        await walletCtx.wallet.stop();
        process.exit(1);
      }

      if (isDustShortage) {
        const currentDustState = await Rx.firstValueFrom(walletCtx.wallet.state());
        const dustBalance = currentDustState.dust.balance(new Date());
        if (attempt < MAX_RETRIES) {
          if (attempt === 1) {
            console.log(`  Still generating DUST, retrying in ${RETRY_DELAY_MS / 1000}s...`);
          } else {
            console.log(`  ⏳ DUST balance: ${dustBalance.toLocaleString()} (attempt ${attempt}/${MAX_RETRIES}); retrying in ${RETRY_DELAY_MS / 1000}s...`);
          }
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        } else {
          console.log(`  ❌ Not enough DUST after ${MAX_RETRIES} retries (current: ${dustBalance.toLocaleString()})`);
          clearInterval(persistInterval);
          await persistWalletState(network, walletCtx);
          await walletCtx.wallet.stop();
          process.exit(1);
        }
      } else {
        throw err;
      }
    }
  }

  if (!deployed) throw new Error('Deployment failed after all retries');

  const contractAddress = deployed.deployTxData.public.contractAddress;
  console.log('  ✅ Contract deployed successfully!\n');
  console.log(`  Contract Address: ${contractAddress}\n`);

  recordDeployment(network, contractAddress, address.toString());
  console.log('  Saved to .midnight-state.json\n');

  await persistWalletState(network, walletCtx);
  clearInterval(persistInterval);
  await walletCtx.wallet.stop();
  console.log('─── Deployment complete ────────────────────────────────────────\n');
  console.log('  Next: npm run cli\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
