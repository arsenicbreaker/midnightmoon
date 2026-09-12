/** Read-only deployment verification; does not submit transactions or load wallet secrets. */
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { verifyContractState } from '@midnight-ntwrk/midnight-js-contracts';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { ledger } from '../managed/counter/contract/index.js';
const address = '4704d059a008791f2f6182d65ca6970c2b921b59f604186e4221dda326b68691';
const deadline = setTimeout(() => { console.error('Preprod verification timed out'); process.exit(1); }, 30000);
try {
  const provider = indexerPublicDataProvider('https://indexer.preprod.midnight.network/api/v4/graphql', 'wss://indexer.preprod.midnight.network/api/v4/graphql/ws');
  const state = await provider.queryContractState(address);
  if (!state) throw new Error('Contract not found');
  verifyContractState(await new NodeZkConfigProvider('managed/counter').getVerifierKeys(['claim', 'increment', 'decrement']), state);
  const current = ledger(state.data);
  console.log(JSON.stringify({ network: 'preprod', contractAddress: address, verifierKeysMatch: true, round: current.round.toString(), hasOwner: current.owner.some(byte => byte !== 0) }, null, 2));
} finally {
  clearTimeout(deadline);
}
