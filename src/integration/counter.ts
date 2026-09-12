import type { ConnectedAPI } from '@midnight-ntwrk/dapp-connector-api';
import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import { Transaction } from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { ZKConfigProvider, createProverKey, createVerifierKey, createZKIR, createProofProvider, type WalletProvider, type MidnightProvider } from '@midnight-ntwrk/midnight-js-types';
import { Contract, ledger } from '../../managed/counter/contract/index.js';
import { witnesses, type CounterPrivateState } from '../witnesses';

export type CircuitName = 'claim' | 'increment' | 'decrement';
export const contractAddress = import.meta.env.VITE_COUNTER_CONTRACT_ADDRESS || '4704d059a008791f2f6182d65ca6970c2b921b59f604186e4221dda326b68691';
export const networkId = import.meta.env.VITE_MIDNIGHT_NETWORK_ID || 'preprod';
const privateStateId = 'counterPrivateState';
const hex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
function unhex(value: string) {
  if (!/^(?:[a-f0-9]{2})+$/i.test(value)) throw new Error('Wallet returned invalid transaction encoding.');
  return Uint8Array.from(value.match(/../g)!, b => parseInt(b, 16));
}
class BrowserZkConfigProvider extends ZKConfigProvider<CircuitName> {
  async read(name: CircuitName, directory: string, extension: string) {
    if (!['claim', 'increment', 'decrement'].includes(name)) throw new Error('Unknown circuit');
    const response = await fetch(`${import.meta.env.BASE_URL}counter/${directory}/${name}.${extension}`);
    if (!response.ok || response.headers.get('content-type')?.includes('text/html')) throw new Error(`Missing compiled artifact for ${name}`);
    return new Uint8Array(await response.arrayBuffer());
  }
  getProverKey(name: CircuitName) { return this.read(name, 'keys', 'prover').then(createProverKey); }
  getVerifierKey(name: CircuitName) { return this.read(name, 'keys', 'verifier').then(createVerifierKey); }
  getZKIR(name: CircuitName) { return this.read(name, 'zkir', 'bzkir').then(createZKIR); }
}

export async function connectCounter(api: ConnectedAPI, account: string, password: string, onPhase: (phase: string) => void) {
  const config = await api.getConfiguration();
  if (config.networkId !== networkId) throw new Error('Wallet network changed. Reconnect on the expected network.');
  if (!/^[a-f0-9]{64}$/i.test(contractAddress)) throw new Error('Invalid counter contract address.');
  setNetworkId(networkId);
  const keys = await api.getShieldedAddresses();
  const zkConfigProvider = new BrowserZkConfigProvider();
  const privateStateProvider = levelPrivateStateProvider<typeof privateStateId, CounterPrivateState>({
    privateStateStoreName: `counter-${networkId}`,
    accountId: account,
    privateStoragePasswordProvider: () => password,
  });
  privateStateProvider.setContractAddress(contractAddress);
  if (!(await privateStateProvider.get(privateStateId))) {
    await privateStateProvider.set(privateStateId, { secretKey: crypto.getRandomValues(new Uint8Array(32)) });
  }
  const walletProvider: WalletProvider = {
    getCoinPublicKey: () => keys.shieldedCoinPublicKey,
    getEncryptionPublicKey: () => keys.shieldedEncryptionPublicKey,
    async balanceTx(tx) {
      onPhase('Approve balancing and signing in Lace');
      const balanced = await api.balanceUnsealedTransaction(hex(tx.serialize()));
      return Transaction.deserialize('signature', 'proof', 'binding', unhex(balanced.tx));
    },
  };
  const midnightProvider: MidnightProvider = {
    async submitTx(tx) {
      onPhase('Submitting transaction');
      await api.submitTransaction(hex(tx.serialize()));
      onPhase('Submitted — waiting for chain confirmation');
      return tx.identifiers()[0];
    },
  };
  const publicDataProvider = indexerPublicDataProvider(config.indexerUri, config.indexerWsUri);
  const proofProvider = createProofProvider(await api.getProvingProvider(zkConfigProvider.asKeyMaterialProvider()));
  const compiledContract = CompiledContract.make('counter', Contract).pipe(CompiledContract.withWitnesses(witnesses), CompiledContract.withCompiledFileAssets('/counter'));
  const found = await findDeployedContract({ privateStateProvider, publicDataProvider, zkConfigProvider, proofProvider, walletProvider, midnightProvider }, {
    compiledContract, contractAddress, privateStateId,
  });
  async function read() {
    const state = await publicDataProvider.queryContractState(contractAddress);
    if (!state) throw new Error('Contract not found on the connected network.');
    return ledger(state.data);
  }
  return {
    read,
    async call(name: CircuitName) {
      const status = await api.getConnectionStatus();
      if (status.status !== 'connected' || status.networkId !== networkId) throw new Error('Wallet disconnected or changed network. Reconnect.');
      onPhase('Building circuit call and generating proof through Lace');
      const result = await found.callTx[name]();
      return { summary: `${name} confirmed on-chain`, txId: result.public.txId, blockHeight: result.public.blockHeight, contractAddress };
    },
  };
}
export type CounterSession = Awaited<ReturnType<typeof connectCounter>>;
