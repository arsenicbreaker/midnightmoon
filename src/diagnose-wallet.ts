import { WebSocket } from 'ws';
import * as Rx from 'rxjs';
import { DustAddress, MidnightBech32m } from '@midnight-ntwrk/wallet-sdk-address-format';
import { getNetworkId } from '@midnight-ntwrk/midnight-js-network-id';

import { resolveNetwork, getOrCreateWallet, formatWalletBackupNotice } from './network';
import { createWallet, persistWalletState, unshieldedToken } from './wallet';

// @ts-expect-error Required for wallet sync
globalThis.WebSocket = WebSocket;

const { network, config: networkConfig } = resolveNetwork();
const walletCredentials = getOrCreateWallet(network);
const notice = formatWalletBackupNotice(walletCredentials, network);
if (notice) console.log(notice);

const timeoutMs = Number(process.env.MIDNIGHT_DIAG_SYNC_TIMEOUT_MS || 120_000);

async function main() {
  console.log(`\nDiagnosing wallet on ${network}...\n`);
  const walletCtx = await createWallet({
    network,
    networkConfig,
    seed: walletCredentials.seed,
  });

  const address = walletCtx.unshieldedKeystore.getBech32Address().toString();
  console.log(`Wallet Address: ${address}`);
  console.log(`Indexer:        ${networkConfig.indexer}`);
  console.log(`RPC:            ${networkConfig.node}`);
  console.log(`Proof Server:   ${networkConfig.proofServer}`);
  if (networkConfig.faucet) console.log(`Faucet:         ${networkConfig.faucet}`);
  try {
    const dustAddress = await walletCtx.wallet.dust.getAddress();
    console.log(`DUST Address:   ${MidnightBech32m.encode(getNetworkId(), dustAddress).toString()}`);
    console.log(`DUST From PK:   ${DustAddress.encodePublicKey(getNetworkId(), walletCtx.dustSecretKey.publicKey)}`);
  } catch (err) {
    console.log(`DUST Address:   <error: ${err instanceof Error ? err.message : String(err)}>`);
  }
  console.log('');

  const persistInterval = setInterval(() => {
    persistWalletState(network, walletCtx).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`Periodic wallet state save failed (${msg}).\n`);
    });
  }, Number(process.env.MIDNIGHT_WALLET_SAVE_INTERVAL_MS || 30_000));

  const startedAt = Date.now();
  let printedShape = false;
  const sub = walletCtx.wallet.state().pipe(Rx.throttleTime(10_000)).subscribe((state) => {
    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    const printable = (value: unknown) => (typeof value === 'bigint' ? value.toString() : value);
    const progressSummary = (progress: unknown) => {
      const p = progress as {
        appliedId?: unknown;
        highestTransactionId?: unknown;
        appliedIndex?: unknown;
        highestRelevantWalletIndex?: unknown;
        highestIndex?: unknown;
        highestRelevantIndex?: unknown;
        isConnected?: unknown;
        isStrictlyComplete?: () => boolean;
        toString?: () => string;
      };
      return {
        complete: typeof p.isStrictlyComplete === 'function' ? p.isStrictlyComplete() : undefined,
        connected: printable(p.isConnected),
        appliedId: printable(p.appliedId),
        highestTransactionId: printable(p.highestTransactionId),
        appliedIndex: printable(p.appliedIndex),
        highestRelevantWalletIndex: printable(p.highestRelevantWalletIndex),
        highestIndex: printable(p.highestIndex),
        highestRelevantIndex: printable(p.highestRelevantIndex),
        text: typeof p.toString === 'function' ? p.toString() : String(progress),
        keys: Object.keys(progress as Record<string, unknown>),
      };
    };
    const summary = {
      isSynced: state.isSynced,
      shieldedProgress: progressSummary(state.shielded.progress),
      unshieldedProgress: progressSummary(state.unshielded.progress),
      dustProgress: progressSummary(state.dust.progress),
      unshieldedCoins: state.unshielded.availableCoins.length,
      unshieldedBalance: (state.unshielded.balances[unshieldedToken().raw] ?? 0n).toString(),
      dustBalance: state.dust.balance(new Date()).toString(),
      coins: state.unshielded.availableCoins.map((coin: any) => ({
        value: String(coin.value ?? coin.utxo?.value ?? ''),
        registeredForDustGeneration: coin.meta?.registeredForDustGeneration ?? coin.registeredForDustGeneration,
        owner: coin.owner ?? coin.utxo?.owner,
        tokenType: coin.tokenType ?? coin.utxo?.tokenType,
      })),
    };
    console.log(`[${elapsed}s] ${JSON.stringify(summary)}`);

    if (!printedShape) {
      printedShape = true;
      console.log(`State keys: ${Object.keys(state).join(', ')}`);
      console.log(`Unshielded keys: ${Object.keys(state.unshielded).join(', ')}`);
      console.log(`Dust keys: ${Object.keys(state.dust as unknown as Record<string, unknown>).join(', ')}`);
    }
  });

  try {
    const state = await Promise.race([
      Rx.firstValueFrom(walletCtx.wallet.state().pipe(Rx.filter((s) => s.isSynced))),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s`)), timeoutMs),
      ),
    ]);

    const tNight = state.unshielded.balances[unshieldedToken().raw] ?? 0n;
    const dust = state.dust.balance(new Date());
    console.log('Wallet sync completed.');
    console.log(`tNight: ${tNight.toLocaleString()}`);
    console.log(`DUST:   ${dust.toLocaleString()}`);
  } finally {
    sub.unsubscribe();
    clearInterval(persistInterval);
    await persistWalletState(network, walletCtx);
    console.log('Saved wallet sync state.');
    await walletCtx.wallet.stop();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
