/**
 * Counter contract tests — circuit logic, state transitions, and privacy.
 *
 * Run: npm test
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  type CircuitContext,
  createConstructorContext,
  createCircuitContext,
  sampleContractAddress,
} from "@midnight-ntwrk/compact-runtime";
import {
  Contract,
  type Ledger,
  ledger,
} from "../managed/counter/contract/index.js";
import {
  type CounterPrivateState,
  witnesses,
} from "../src/witnesses.js";

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.floor(Math.random() * 256);
  return out;
}

/** Local in-memory simulator for the counter contract. */
class CounterSimulator {
  readonly contract: Contract<CounterPrivateState>;
  circuitContext: CircuitContext<CounterPrivateState>;

  constructor(secretKey: Uint8Array) {
    this.contract = new Contract<CounterPrivateState>(witnesses);
    const {
      currentPrivateState,
      currentContractState,
      currentZswapLocalState,
    } = this.contract.initialState(
      createConstructorContext({ secretKey }, "0".repeat(64)),
    );
    this.circuitContext = createCircuitContext(
      sampleContractAddress(),
      currentZswapLocalState,
      currentContractState,
      currentPrivateState,
    );
  }

  getLedger(): Ledger {
    return ledger(this.circuitContext.currentQueryContext.state);
  }

  getPrivateState(): CounterPrivateState {
    return this.circuitContext.currentPrivateState;
  }

  claim(): Ledger {
    this.circuitContext = this.contract.impureCircuits.claim(
      this.circuitContext,
    ).context;
    return this.getLedger();
  }

  increment(): Ledger {
    this.circuitContext = this.contract.impureCircuits.increment(
      this.circuitContext,
    ).context;
    return this.getLedger();
  }

  decrement(): Ledger {
    this.circuitContext = this.contract.impureCircuits.decrement(
      this.circuitContext,
    ).context;
    return this.getLedger();
  }

  switchUser(secretKey: Uint8Array) {
    this.circuitContext = {
      ...this.circuitContext,
      currentPrivateState: { secretKey },
    };
  }
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function ledgerJson(state: Ledger) {
  return {
    round: state.round.toString(),
    owner: Buffer.from(state.owner).toString("hex"),
  };
}

describe("counter", () => {
  it("circuit logic: claim derives a public owner commitment from the private secret", () => {
    const secret = randomBytes(32);
    const sim = new CounterSimulator(secret);

    // Before claim: owner is the zero default, counter is 0
    assert.equal(sim.getLedger().round, 0n);
    assert.ok(sim.getLedger().owner.every((b) => b === 0));

    const afterClaim = sim.claim();
    assert.equal(afterClaim.round, 0n);
    // Owner commitment must be non-zero (hash of secret) — circuit produced a public key
    assert.ok(
      afterClaim.owner.some((b) => b !== 0),
      "owner commitment should be non-zero after claim",
    );
    // Claiming twice with the same secret is deterministic
    const sim2 = new CounterSimulator(secret);
    sim2.claim();
    assert.ok(
      bytesEqual(sim.getLedger().owner, sim2.getLedger().owner),
      "same secret must produce the same disclosed owner commitment",
    );
  });

  it("state transitions: claim → increment → decrement updates the public counter", () => {
    const sim = new CounterSimulator(randomBytes(32));
    sim.claim();

    assert.equal(sim.getLedger().round, 0n);

    const afterInc1 = sim.increment();
    assert.equal(afterInc1.round, 1n);

    const afterInc2 = sim.increment();
    assert.equal(afterInc2.round, 2n);

    const afterDec = sim.decrement();
    assert.equal(afterDec.round, 1n);

    // Unauthorized user cannot increment (ownership assertion fails)
    sim.switchUser(randomBytes(32));
    assert.throws(
      () => sim.increment(),
      /Only the owner can increment|failed assert/,
    );
  });

  it("private inputs are never exposed on the public ledger", () => {
    const secret = randomBytes(32);
    const sim = new CounterSimulator(secret);
    sim.claim();
    sim.increment();
    sim.increment();

    const publicLedger = sim.getLedger();
    const privateState = sim.getPrivateState();

    // Secret lives only in private state
    assert.ok(bytesEqual(privateState.secretKey, secret));

    // Public ledger never contains the raw secret key bytes
    const ledgerSerialized = JSON.stringify(ledgerJson(publicLedger));
    const secretHex = Buffer.from(secret).toString("hex");
    assert.equal(
      ledgerSerialized.includes(secretHex),
      false,
      "raw secret key must not appear in public ledger serialization",
    );

    // Owner is a commitment (hash), not the secret itself
    assert.equal(publicLedger.owner.length, 32);
    assert.equal(
      bytesEqual(publicLedger.owner, secret),
      false,
      "owner field must not equal the private secret key",
    );

    // Only public fields present on ledger shape
    assert.deepEqual(Object.keys(publicLedger).sort(), ["owner", "round"]);
    assert.equal(typeof publicLedger.round, "bigint");
  });
});
