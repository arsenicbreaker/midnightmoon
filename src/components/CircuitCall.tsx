import { AlertCircle, CheckCircle2, Loader2, ShieldCheck } from "lucide-react";
import { useState } from "react";

export type CircuitTransactionResult = {
  summary: string;
  txId?: string;
  blockHeight?: bigint | number | string;
  contractAddress?: string;
};

type CircuitCallProps = {
  name: "claim" | "increment" | "decrement";
  label: string;
  description: string;
  disabled?: boolean;
  onCall: () => Promise<CircuitTransactionResult>;
};

type CallState =
  | { status: "idle"; message: string }
  | { status: "loading"; message: string }
  | { status: "success"; message: string; result: CircuitTransactionResult }
  | { status: "error"; message: string };

export function CircuitCall({
  name,
  label,
  description,
  disabled = false,
  onCall,
}: CircuitCallProps) {
  const [state, setState] = useState<CallState>({
    status: "idle",
    message: "Ready",
  });

  async function handleCall() {
    setState({
      status: "loading",
      message: `Generating local proof for ${name}`,
    });

    try {
      const result = await onCall();
      setState({ status: "success", message: result.summary, result });
    } catch (error) {
      setState({
        status: "error",
        message: error instanceof Error ? error.message : "Circuit call failed",
      });
    }
  }

  const isLoading = state.status === "loading";

  return (
    <article className="circuit-call">
      <div className="circuit-copy">
        <h3>{label}</h3>
        <p>{description}</p>
        <p className="privacy-label">
          <ShieldCheck aria-hidden="true" />
          Proved without revealing your input
        </p>
      </div>
      <div className="circuit-controls">
        <button
          className="secondary-button"
          type="button"
          onClick={handleCall}
          disabled={disabled || isLoading}
          aria-busy={isLoading}
        >
          {isLoading ? <Loader2 aria-hidden="true" className="spin" /> : null}
          Call
        </button>
        <p className={`result result-${state.status}`} role={state.status === "error" ? "alert" : "status"}>
          {state.status === "success" ? <CheckCircle2 aria-hidden="true" /> : null}
          {state.status === "error" ? <AlertCircle aria-hidden="true" /> : null}
          {state.message}
        </p>
        {state.status === "success" ? (
          <dl className="tx-result" aria-label={`${label} transaction result`}>
            {state.result.txId ? (
              <>
                <dt>Transaction</dt>
                <dd>{state.result.txId}</dd>
              </>
            ) : null}
            {state.result.blockHeight ? (
              <>
                <dt>Block</dt>
                <dd>{state.result.blockHeight.toString()}</dd>
              </>
            ) : null}
            {state.result.contractAddress ? (
              <>
                <dt>Contract</dt>
                <dd>{state.result.contractAddress}</dd>
              </>
            ) : null}
          </dl>
        ) : null}
      </div>
    </article>
  );
}
