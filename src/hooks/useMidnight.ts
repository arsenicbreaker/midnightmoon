import { useCallback, useMemo, useState, useRef, useEffect } from "react";
import { ErrorCodes, type APIError, type ConnectedAPI, type InitialAPI } from "@midnight-ntwrk/dapp-connector-api";
import type { CircuitTransactionResult } from "../components/CircuitCall";

import { connectCounter, networkId, type CounterSession } from "../integration/counter";

export type ConnectionStatus = "disconnected" | "connecting" | "connected";
export type CircuitName = "claim" | "increment" | "decrement";

type WalletConnector = {
  id: string;
  api: InitialAPI;
};

type MidnightState = {
  address: string | null;
  connectionStatus: ConnectionStatus;
  error: string | null;
  walletName: string | null;
  desiredNetworkId: string;
  round: bigint | null;
  busy: boolean;
  phase: string;
  password: string;
  setPassword: (value: string) => void;
  hasOwner: boolean;
  isConnected: boolean;
  connectWallet: () => Promise<void>;
  disconnectWallet: () => void;
  callCircuit: (name: CircuitName) => Promise<CircuitTransactionResult>;
};

const DESIRED_NETWORK_ID = networkId;

function isDAppConnectorError(error: unknown): error is APIError {
  return (
    error instanceof Error &&
    "type" in error &&
    "code" in error &&
    error.type === "DAppConnectorAPIError"
  );
}

function formatConnectorError(error: unknown): string {
  if (isDAppConnectorError(error)) {
    if (
      error.code === ErrorCodes.Rejected ||
      error.code === ErrorCodes.PermissionRejected
    ) {
      return "Connection request rejected in Lace.";
    }

    if (error.code === ErrorCodes.Disconnected) {
      return "Lace disconnected before the wallet was ready.";
    }

    return error.reason || "Lace could not complete the connection request.";
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Could not connect to Lace wallet.";
}

function findLaceConnector(): WalletConnector | null {
  const connectors = window.midnight;

  if (!connectors) {
    return null;
  }

  const wallets = Object.entries(connectors).map(([id, api]) => ({ id, api }));

  return (
    wallets.find(({ id, api }) => {
      const haystack = `${id} ${api.name} ${api.rdns}`.toLowerCase();
      return haystack.includes("lace");
    }) ??
    wallets[0] ??
    null
  );
}

async function readWalletAddress(api: ConnectedAPI): Promise<string> {
  const [{ unshieldedAddress }, { shieldedAddress }, { dustAddress }] =
    await Promise.all([
      api.getUnshieldedAddress().catch(() => ({ unshieldedAddress: "" })),
      api.getShieldedAddresses().catch(() => ({ shieldedAddress: "" })),
      api.getDustAddress().catch(() => ({ dustAddress: "" })),
    ]);

  const address = unshieldedAddress || shieldedAddress || dustAddress;

  if (!address) {
    throw new Error("Lace connected, but no wallet address was returned.");
  }

  return address;
}

export function useMidnight(): MidnightState {
  const [address, setAddress] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("disconnected");
  const [error, setError] = useState<string | null>(null);
  const [walletName, setWalletName] = useState<string | null>(null);
  const [connectedApi, setConnectedApi] = useState<ConnectedAPI | null>(null);
  const [round, setRound] = useState<bigint | null>(null);
  const [hasOwner, setHasOwner] = useState(false);

  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState('Connect to read the deployed ledger');
  const session = useRef<CounterSession | null>(null);
  const generation = useRef(0);
  const pending = useRef(false);
  useEffect(() => {
    if (connectionStatus !== 'connected') return;
    const current = session.current;
    const refresh = () => current?.read().then(state => {
      if (session.current !== current) return;
      setRound(state.round);
      setHasOwner(state.owner.some(byte => byte !== 0));
    }).catch(() => {
      if (session.current === current) setError('Unable to refresh ledger state. Reconnect to retry.');
    });
    const timer = window.setInterval(refresh, 10000);
    return () => window.clearInterval(timer);
  }, [connectionStatus]);

  const connectWallet = useCallback(async () => {
    if (pending.current) return;
    const version = ++generation.current;
    setError(null);
    setConnectionStatus("connecting");

    try {
      const connector = findLaceConnector();

      if (!connector) {
        throw new Error("Lace wallet is not installed or is not available in this browser.");
      }

      const api = await connector.api.connect(DESIRED_NETWORK_ID);
      const status = await api.getConnectionStatus();

      if (status.status !== "connected") {
        throw new Error("Lace did not finish connecting. Try again.");
      }

      if (status.networkId !== DESIRED_NETWORK_ID) {
        throw new Error(
          `Network mismatch. Switch Lace to ${DESIRED_NETWORK_ID}; it is currently on ${status.networkId}.`,
        );
      }

      const walletAddress = await readWalletAddress(api);
      setPhase('Verifying deployed circuit keys and loading ledger');
      const counter = await connectCounter(api, walletAddress, password, setPhase);
      const state = await counter.read();
      if (version !== generation.current) return;
      session.current = counter;
      setRound(state.round);
      setHasOwner(state.owner.some(byte => byte !== 0));
      setPhase('Connected to verified contract');
      setConnectedApi(api);
      setWalletName(connector.api.name || "Lace");
      setAddress(walletAddress);
      setConnectionStatus("connected");
    } catch (caught) {
      if (version !== generation.current) return;
      setConnectedApi(null);
      setWalletName(null);
      setAddress(null);
      setConnectionStatus("disconnected");
      setError(formatConnectorError(caught));
    }
  }, [password]);

  const disconnectWallet = useCallback(() => {
    if (pending.current) return;
    generation.current++;
    session.current = null;
    setRound(null);
    setHasOwner(false);
    setPassword('');
    setPhase('Disconnected');
    setConnectedApi(null);
    setWalletName(null);
    setAddress(null);
    setConnectionStatus("disconnected");
    setError(null);
  }, []);

  const callCircuit = useCallback(
    async (name: CircuitName) => {
      const current = session.current;
      if (!current) throw new Error('Connect and unlock private state first.');
      if (pending.current) throw new Error('Wait for the pending transaction.');
      pending.current = true;
      setBusy(true);
      setError(null);
      try {
        const result = await current.call(name);
        try {
          const state = await current.read();
          setRound(state.round);
          setHasOwner(state.owner.some(byte => byte !== 0));
        } catch {
          setError('Transaction confirmed, but ledger refresh failed. Reconnect to reload.');
        }
        setPhase(result.summary);
        return result;
      } catch (caught) {
        setPhase('Call failed or confirmation unavailable. Check Lace history before retrying.');
        throw caught;
      } finally {
        pending.current = false;
        setBusy(false);
      }
    }, [],
  );

  return useMemo(
    () => ({
      busy, phase, password, setPassword,
      address,
      connectionStatus,
      error,
      walletName,
      desiredNetworkId: DESIRED_NETWORK_ID,
      round,
      hasOwner,
      isConnected: connectionStatus === "connected" && connectedApi !== null,
      connectWallet,
      disconnectWallet,
      callCircuit,
    }),
    [
      busy, phase, password,
      address,
      callCircuit,
      connectWallet,
      connectedApi,
      connectionStatus,
      disconnectWallet,
      error,
      hasOwner,
      round,
      walletName,
    ],
  );
}
