// Wallet construction + sync-state restore.
//
// Mirrors network.ts in structure. The on-disk format and pure I/O live in
// wallet-state.ts (unit-tested from the scaffolder workspace, no SDK deps);
// this file is the glue between that format and the wallet SDK.

import { Buffer } from 'buffer';

// Ledger types now come from the midnight-js-protocol barrel, which re-exports
// ledger-v8 (8.1.0) under a stable subpath instead of depending on it directly.
import * as ledger from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { unshieldedToken } from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { setNetworkId, getNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
// As of Midnight.js 4.1.x / ledger-v8 8.1.0 the wallet SDK is consolidated behind
// the single @midnight-ntwrk/wallet-sdk barrel, which re-exports the former
// wallet-sdk-facade / -hd / -shielded / -dust-wallet / -unshielded-wallet packages.
import {
  WalletFacade,
  DustWallet,
  HDWallet,
  Roles,
  ShieldedWallet,
  createKeystore,
  NoOpTransactionHistoryStorage,
  PublicKey,
  UnshieldedWallet,
} from '@midnight-ntwrk/wallet-sdk';

import type { NetworkConfig, NetworkId } from './network';
import {
  CHILD_KINDS,
  loadWalletState,
  saveWalletState,
  type ChildKind,
  type PersistedWalletState,
} from './wallet-state';

export { unshieldedToken };
export type { PersistedWalletState };
export {
  loadWalletState,
  saveWalletState,
  clearWalletState,
  WALLET_STATE_DIR,
  WALLET_STATE_VERSION,
} from './wallet-state';

function deriveKeys(seed: string) {
  const hdWallet = HDWallet.fromSeed(Buffer.from(seed, 'hex'));
  if (hdWallet.type !== 'seedOk') throw new Error('Invalid seed');
  const result = hdWallet.hdWallet
    .selectAccount(0)
    .selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust])
    .deriveKeysAt(0);
  if (result.type !== 'keysDerived') throw new Error('Key derivation failed');
  hdWallet.hdWallet.clear();
  return result.keys;
}

export interface WalletContext {
  wallet: Awaited<ReturnType<typeof WalletFacade.init>>;
  shieldedSecretKeys: ReturnType<typeof ledger.ZswapSecretKeys.fromSeed>;
  dustSecretKey: ReturnType<typeof ledger.DustSecretKey.fromSeed>;
  unshieldedKeystore: ReturnType<typeof createKeystore>;
  restored: { shielded: boolean; unshielded: boolean; dust: boolean };
}

export interface CreateWalletOptions {
  network: NetworkId;
  networkConfig: NetworkConfig;
  seed: string;
  /**
   * Whether to attempt to restore each child wallet from saved state.
   * Defaults to true. Pass false to force a from-seed sync (used by tests).
   */
  restore?: boolean;
  cwd?: string;
}

function warnRestoreFailure(kind: ChildKind, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`  ⚠ Could not restore ${kind} wallet state (${msg}); falling back to fresh sync.\n`);
}

/**
 * Build the wallet facade, restoring each child from saved state when
 * available and falling back to a from-seed start when not (or when restore
 * throws, e.g. after an SDK upgrade with an incompatible state format).
 *
 * Caller is responsible for `await wallet.waitForSyncedState()` afterwards.
 */
export async function createWallet(opts: CreateWalletOptions): Promise<WalletContext> {
  setNetworkId(opts.networkConfig.networkId);

  const keys = deriveKeys(opts.seed);
  const networkId = getNetworkId();
  const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(keys[Roles.Zswap]);
  const dustSecretKey = ledger.DustSecretKey.fromSeed(keys[Roles.Dust]);
  const unshieldedKeystore = createKeystore(keys[Roles.NightExternal], networkId);

  const saved: PersistedWalletState = opts.restore === false
    ? {}
    : loadWalletState(opts.network, { cwd: opts.cwd });

  const restored = { shielded: false, unshielded: false, dust: false };

  const walletConfig = {
    networkId,
    indexerClientConnection: {
      indexerHttpUrl: opts.networkConfig.indexer,
      indexerWsUrl: opts.networkConfig.indexerWS,
    },
    provingServerUrl: new URL(opts.networkConfig.proofServer),
    relayURL: new URL(opts.networkConfig.node.replace(/^http/, 'ws')),
    txHistoryStorage: new NoOpTransactionHistoryStorage(),
    costParameters: { additionalFeeOverhead: 300_000_000_000_000n, feeBlocksMargin: 5 },
  };

  const wallet = await WalletFacade.init({
    configuration: walletConfig,
    shielded: async (config) => {
      const cls = ShieldedWallet(config);
      if (saved.shielded !== undefined) {
        try {
          const restoredWallet = await (cls as any).restore(saved.shielded);
          restored.shielded = true;
          return restoredWallet;
        } catch (err) {
          warnRestoreFailure('shielded', err);
        }
      }
      return cls.startWithSecretKeys(shieldedSecretKeys);
    },
    unshielded: async (config) => {
      const cls = UnshieldedWallet(config);
      if (saved.unshielded !== undefined) {
        try {
          const restoredWallet = await (cls as any).restore(saved.unshielded);
          restored.unshielded = true;
          return restoredWallet;
        } catch (err) {
          warnRestoreFailure('unshielded', err);
        }
      }
      return cls.startWithPublicKey(PublicKey.fromKeyStore(unshieldedKeystore));
    },
    dust: async (config) => {
      const cls = DustWallet(config);
      if (saved.dust !== undefined) {
        try {
          const restoredWallet = await (cls as any).restore(saved.dust);
          restored.dust = true;
          return restoredWallet;
        } catch (err) {
          warnRestoreFailure('dust', err);
        }
      }
      return cls.startWithSecretKey(dustSecretKey, ledger.LedgerParameters.initialParameters().dust);
    },
  });

  await wallet.start(shieldedSecretKeys, dustSecretKey);

  return { wallet, shieldedSecretKeys, dustSecretKey, unshieldedKeystore, restored };
}

/**
 * Serialize each child wallet's current state and persist it for the next run.
 * Safe to call multiple times. Logs but does not throw on individual failures —
 * losing one child's state means the next run re-syncs that child only.
 */
export async function persistWalletState(
  network: NetworkId,
  ctx: WalletContext,
  cwd?: string,
): Promise<void> {
  const next: PersistedWalletState = {};

  for (const kind of CHILD_KINDS) {
    try {
      const child = (ctx.wallet as unknown as Record<ChildKind, { serializeState: () => Promise<unknown> }>)[kind];
      const serialized = await child.serializeState();
      if (kind === 'dust') {
        next.dust = serialized as string;
      } else {
        next[kind] = serialized;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`  ⚠ Could not serialize ${kind} wallet state (${msg}); next run will re-sync.\n`);
    }
  }

  saveWalletState(network, next, { cwd });
}

type SyncProgressLike = {
  isConnected?: boolean;
  appliedIndex?: bigint;
  highestIndex?: bigint;
  appliedId?: bigint;
  highestTransactionId?: bigint;
  isStrictlyComplete?: () => boolean;
};

function formatProgress(progress: SyncProgressLike | undefined): string {
  if (!progress) return 'waiting for state';

  const applied = progress.appliedIndex ?? progress.appliedId ?? 0n;
  const highest = progress.highestIndex ?? progress.highestTransactionId ?? 0n;
  const connected = progress.isConnected ? 'connected' : 'disconnected';
  const complete = progress.isStrictlyComplete?.() ?? false;
  const percentage = highest > 0n
    ? `${(Number((applied * 1_000n) / highest) / 10).toFixed(1)}%`
    : complete ? '100.0%' : '0.0%';

  return `${connected}, ${applied.toLocaleString()}/${highest.toLocaleString()} (${percentage})`;
}

/**
 * Wait for all child wallets while exposing per-wallet progress and writing
 * resumable checkpoints. Checkpoint writes are serialized so a slow disk or a
 * large shielded state cannot produce overlapping snapshots.
 */
export async function waitForWalletSync(
  network: NetworkId,
  ctx: WalletContext,
  opts: { cwd?: string; progressIntervalMs?: number; checkpointIntervalMs?: number } = {},
) {
  const progressIntervalMs = opts.progressIntervalMs ?? 5_000;
  const checkpointIntervalMs = opts.checkpointIntervalMs ?? 30_000;
  const startedAt = Date.now();
  let latestState: any;
  let checkpointInFlight: Promise<void> | null = null;

  const subscription = ctx.wallet.state().subscribe({
    next: (state) => { latestState = state; },
    error: (err) => {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`\n  ⚠ Wallet progress stream failed: ${msg}\n`);
    },
  });

  const printProgress = () => {
    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    const shielded = formatProgress(latestState?.shielded?.state?.progress);
    const unshielded = formatProgress(latestState?.unshielded?.progress);
    const dust = formatProgress(latestState?.dust?.state?.progress);
    process.stdout.write(
      `\n  ⏳ Sync ${elapsed}s | shielded: ${shielded} | unshielded: ${unshielded} | dust: ${dust}`,
    );
  };

  const saveCheckpoint = () => {
    if (checkpointInFlight) return;
    checkpointInFlight = persistWalletState(network, ctx, opts.cwd)
      .then(() => { process.stdout.write('\n  💾 Wallet sync checkpoint saved.'); })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`\n  ⚠ Could not save wallet sync checkpoint: ${msg}`);
      })
      .finally(() => { checkpointInFlight = null; });
  };

  printProgress();
  const progressTimer = setInterval(printProgress, progressIntervalMs);
  const checkpointTimer = setInterval(saveCheckpoint, checkpointIntervalMs);

  try {
    const state = await ctx.wallet.waitForSyncedState();
    if (checkpointInFlight) await checkpointInFlight;
    await persistWalletState(network, ctx, opts.cwd);
    return state;
  } finally {
    clearInterval(progressTimer);
    clearInterval(checkpointTimer);
    subscription.unsubscribe();
    if (checkpointInFlight) await checkpointInFlight;
  }
}
