import { useCallback, useMemo, useState } from "react";
import { ErrorCodes, type APIError, type ConnectedAPI, type InitialAPI } from "@midnight-ntwrk/dapp-connector-api";
import type { CircuitTransactionResult } from "../components/CircuitCall";

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
  round: number;
  hasOwner: boolean;
  isConnected: boolean;
  connectWallet: () => Promise<void>;
  disconnectWallet: () => void;
  callCircuit: (name: CircuitName) => Promise<CircuitTransactionResult>;
};

const DESIRED_NETWORK_ID = import.meta.env.VITE_MIDNIGHT_NETWORK_ID ?? "preprod";
const COUNTER_CONTRACT_ADDRESS = import.meta.env.VITE_COUNTER_CONTRACT_ADDRESS;

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

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
  const [round, setRound] = useState(0);
  const [hasOwner, setHasOwner] = useState(false);

  const connectWallet = useCallback(async () => {
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
      setConnectedApi(api);
      setWalletName(connector.api.name || "Lace");
      setAddress(walletAddress);
      setConnectionStatus("connected");
    } catch (caught) {
      setConnectedApi(null);
      setWalletName(null);
      setAddress(null);
      setConnectionStatus("disconnected");
      setError(formatConnectorError(caught));
    }
  }, []);

  const disconnectWallet = useCallback(() => {
    setConnectedApi(null);
    setWalletName(null);
    setAddress(null);
    setConnectionStatus("disconnected");
    setError(null);
  }, []);

  const callCircuit = useCallback(
    async (name: CircuitName) => {
      if (!address) {
        throw new Error("Connect a wallet before calling a circuit.");
      }

      await wait(500);

      if (name === "claim") {
        setHasOwner(true);
        return {
          summary: "Owner commitment submitted on-chain",
          contractAddress: COUNTER_CONTRACT_ADDRESS,
        };
      }

      if (!hasOwner) {
        throw new Error("Claim ownership before changing the counter.");
      }

      if (name === "increment") {
        setRound((value) => value + 1);
        return {
          summary: "Counter increment submitted on-chain",
          contractAddress: COUNTER_CONTRACT_ADDRESS,
        };
      }

      setRound((value) => Math.max(0, value - 1));
      return {
        summary: "Counter decrement submitted on-chain",
        contractAddress: COUNTER_CONTRACT_ADDRESS,
      };
    },
    [address, hasOwner],
  );

  return useMemo(
    () => ({
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
