import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import {
  connectWallet,
  disconnectWallet,
  getStoredWalletState,
  callComputeScore,
  callVerifyThreshold,
  readContractState,
  type CircuitResult,
  type ThresholdResult,
  type ContractLedgerState,
} from '../services/midnight-provider';

interface MidnightContextValue {
  address: string | null;
  isConnected: boolean;
  isLoading: boolean;
  error: string | null;
  isRealWallet: boolean;
  network: string | null;
  contractState: ContractLedgerState | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  callCircuit: (inputs: {
    walletAge: number;
    txFrequency: number;
    defiInteractions: number;
    repaymentHistory: number;
    assetDiversity: number;
    liquidationHistory: number;
  }) => Promise<CircuitResult>;
  verifyThreshold: (actualScore: number, minimumScore: number) => Promise<ThresholdResult>;
  refreshContractState: () => Promise<void>;
}

const MidnightContext = createContext<MidnightContextValue | null>(null);

export function MidnightProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isRealWallet, setIsRealWallet] = useState(false);
  const [network, setNetwork] = useState<string | null>(null);
  const [contractState, setContractState] = useState<ContractLedgerState | null>(null);

  // Restore session on mount
  useEffect(() => {
    const stored = getStoredWalletState();
    if (stored && stored.isConnected) {
      setAddress(stored.address);
      setIsConnected(true);
      setIsRealWallet(stored.isRealWallet);
      setNetwork(stored.network);
    }
  }, []);

  // Fetch contract state when connected
  useEffect(() => {
    if (isConnected) {
      readContractState().then((state) => {
        if (state) setContractState(state);
      });
    }
  }, [isConnected]);

  const connect = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('CONNECTION_TIMEOUT')), 30000)
      );

      const state = await Promise.race([connectWallet(), timeoutPromise]);
      setAddress(state.address);
      setIsConnected(true);
      setIsRealWallet(state.isRealWallet);
      setNetwork(state.network);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';

      if (message === 'USER_REJECTED') {
        setError('Connection rejected. Please approve the connection in your wallet.');
      } else if (message === 'CONNECTION_TIMEOUT') {
        setError('Connection timed out. Please try again.');
      } else if (message === 'WALLET_NOT_INSTALLED') {
        setError('Lace wallet not detected. Please install it from lace.io');
      } else {
        setError(`Connection failed: ${message}`);
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    disconnectWallet();
    setAddress(null);
    setIsConnected(false);
    setIsRealWallet(false);
    setNetwork(null);
    setContractState(null);
    setError(null);
  }, []);

  const callCircuit = useCallback(
    async (inputs: {
      walletAge: number;
      txFrequency: number;
      defiInteractions: number;
      repaymentHistory: number;
      assetDiversity: number;
      liquidationHistory: number;
    }): Promise<CircuitResult> => {
      setIsLoading(true);
      setError(null);

      try {
        const result = await callComputeScore(inputs);
        // Refresh contract state after successful circuit call
        const newState = await readContractState();
        if (newState) setContractState(newState);
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Circuit call failed';
        setError(message);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  const verifyThreshold = useCallback(
    async (actualScore: number, minimumScore: number): Promise<ThresholdResult> => {
      setIsLoading(true);
      setError(null);

      try {
        const result = await callVerifyThreshold(actualScore, minimumScore);
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Verification failed';
        setError(message);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  const refreshContractState = useCallback(async () => {
    const state = await readContractState();
    if (state) setContractState(state);
  }, []);

  return (
    <MidnightContext.Provider
      value={{
        address,
        isConnected,
        isLoading,
        error,
        isRealWallet,
        network,
        contractState,
        connect,
        disconnect,
        callCircuit,
        verifyThreshold,
        refreshContractState,
      }}
    >
      {children}
    </MidnightContext.Provider>
  );
}

export function useMidnightContext(): MidnightContextValue {
  const context = useContext(MidnightContext);
  if (!context) {
    throw new Error('useMidnightContext must be used within a MidnightProvider');
  }
  return context;
}
