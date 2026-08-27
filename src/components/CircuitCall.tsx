import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { useState } from "react";

type CircuitCallProps = {
  name: "claim" | "increment" | "decrement";
  label: string;
  description: string;
  disabled?: boolean;
  onCall: () => Promise<string>;
};

type CallState =
  | { status: "idle"; message: string }
  | { status: "loading"; message: string }
  | { status: "success"; message: string }
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
    setState({ status: "loading", message: `Submitting ${name}` });

    try {
      const message = await onCall();
      setState({ status: "success", message });
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
      </div>
    </article>
  );
}
