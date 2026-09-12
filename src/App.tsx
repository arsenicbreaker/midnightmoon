import { CircuitCall } from "./components/CircuitCall";
import { WalletConnect } from "./components/WalletConnect";
import { useMidnight } from "./hooks/useMidnight";

export default function App() {
  const midnight = useMidnight();

  return (
    <main className="app-shell">
      <section className="workspace" aria-labelledby="app-title">
        <header className="topbar">
          <div>
            <p className="eyebrow">Midnight Builder Challenge</p>
            <h1 id="app-title">Private Counter</h1>
          </div>
          <WalletConnect
            address={midnight.address}
            connectionStatus={midnight.connectionStatus}
            error={midnight.error}
            walletName={midnight.walletName}
            desiredNetworkId={midnight.desiredNetworkId}
            onConnect={midnight.connectWallet}
            onDisconnect={midnight.disconnectWallet}
          />
        </header>

        {!midnight.isConnected && <label>
          Private state password
          <input type="password" autoComplete="current-password" value={midnight.password}
            onChange={event => midnight.setPassword(event.target.value)} disabled={midnight.connectionStatus === 'connecting'} />
          <p className="muted">Use at least 16 characters with uppercase, lowercase, a number and a symbol. Reuse this password to unlock your encrypted ownership secret in this browser.</p>
        </label>}
        <p role="status">{midnight.phase}</p>
        {midnight.isConnected && midnight.error && <p role="alert">{midnight.error}</p>}
        <p className="muted">This deployed demo allows anyone to claim again and replace the owner. Increment and decrement require the current owner's private secret.</p>
        <div className="dashboard-grid">
          <section className="panel counter-panel" aria-labelledby="counter-title">
            <div>
              <p className="eyebrow">Public ledger state</p>
              <h2 id="counter-title">Round</h2>
            </div>
            <p className="counter-value" aria-live="polite">
              {midnight.round?.toString() ?? '—'}
            </p>
            <p className="muted">
              The counter value is public. Ownership is proven with a private
              witness when a circuit call is submitted.
            </p>
          </section>

          <section className="panel actions-panel" aria-labelledby="actions-title">
            <div>
              <p className="eyebrow">Circuit calls</p>
              <h2 id="actions-title">Contract actions</h2>
            </div>
            <div className="action-stack">
              <CircuitCall
                name="claim"
                label="Claim ownership"
                description="Publish the owner commitment derived from your private key."
                disabled={midnight.busy || !midnight.isConnected}
                onCall={() => midnight.callCircuit("claim")}
              />
              <CircuitCall
                name="increment"
                label="Increment"
                description="Prove ownership and increase the public round."
                disabled={midnight.busy || !midnight.isConnected || !midnight.hasOwner}
                onCall={() => midnight.callCircuit("increment")}
              />
              <CircuitCall
                name="decrement"
                label="Decrement"
                description="Prove ownership and decrease the public round."
                disabled={midnight.busy || !midnight.isConnected || !midnight.hasOwner}
                onCall={() => midnight.callCircuit("decrement")}
              />
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}
