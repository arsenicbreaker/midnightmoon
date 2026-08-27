import { AlertCircle, CheckCircle2, Copy, LogOut, PlugZap, Wallet } from "lucide-react";
import type { ConnectionStatus } from "../hooks/useMidnight";

type WalletConnectProps = {
  address: string | null;
  connectionStatus: ConnectionStatus;
  error: string | null;
  walletName: string | null;
  desiredNetworkId: string;
  onConnect: () => Promise<void>;
  onDisconnect: () => void;
};

function truncateAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function WalletConnect({
  address,
  connectionStatus,
  error,
  walletName,
  desiredNetworkId,
  onConnect,
  onDisconnect,
}: WalletConnectProps) {
  const isConnecting = connectionStatus === "connecting";
  const isConnected = connectionStatus === "connected" && address;

  async function copyAddress() {
    if (!address) return;
    await navigator.clipboard.writeText(address);
  }

  if (isConnected) {
    return (
      <div className="wallet-card" aria-label="Connected wallet">
        <div className="wallet-identity">
          <CheckCircle2 aria-hidden="true" className="status-icon" />
          <Wallet aria-hidden="true" />
          <span className="wallet-name">{walletName ?? "Lace"}</span>
          <span className="address">{truncateAddress(address)}</span>
        </div>
        <div className="wallet-actions">
          <button
            className="icon-button"
            type="button"
            onClick={copyAddress}
            aria-label="Copy wallet address"
          >
            <Copy aria-hidden="true" />
          </button>
          <button
            className="icon-button"
            type="button"
            onClick={onDisconnect}
            aria-label="Disconnect wallet"
          >
            <LogOut aria-hidden="true" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="connect-stack">
      <p className="wallet-state">
        <AlertCircle aria-hidden="true" />
        Wallet disconnected
      </p>
      <button
        className="primary-button"
        type="button"
        onClick={onConnect}
        disabled={isConnecting}
        aria-busy={isConnecting}
      >
        <PlugZap aria-hidden="true" />
        {isConnecting ? "Connecting to Lace" : "Connect Lace"}
      </button>
      <p className="network-hint">Expected network: {desiredNetworkId}</p>
      {error ? (
        <p className="inline-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
