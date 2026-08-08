/**
 * Witness implementations for contracts/counter.compact.
 *
 * secretKey() is private: it is read from local private state only and never
 * serialized into public ledger fields.
 */
import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';

export type CounterPrivateState = {
  readonly secretKey: Uint8Array;
};

export const createCounterPrivateState = (
  secretKey: Uint8Array,
): CounterPrivateState => ({ secretKey });

export type CounterLedger = {
  readonly round: bigint;
  readonly owner: Uint8Array;
};

export const witnesses = {
  secretKey: ({
    privateState,
  }: WitnessContext<CounterLedger, CounterPrivateState>): [
    CounterPrivateState,
    Uint8Array,
  ] => [privateState, privateState.secretKey],
};
