import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import {
  connectWallet,
  disconnectWallet,
  getStoredWalletState,
  callComputeScore,
  type CircuitResult,
} from '../services/midnight-provider';

interface MidnightContextValue {
  address: string | null;
  isConnected: boolean;
  isLoading: boolean;
  error: string | null;
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
}

const MidnightContext = createContext<MidnightContextValue | null>(null);

export function MidnightProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Restore session on mount
  useEffect(() => {
    const stored = getStoredWalletState();
    if (stored && stored.isConnected) {
      setAddress(stored.address);
      setIsConnected(true);
    }
  }, []);

  const connect = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      // 30s timeout
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('CONNECTION_TIMEOUT')), 30000)
      );

      const state = await Promise.race([connectWallet(), timeoutPromise]);
      setAddress(state.address);
      setIsConnected(true);
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

  return (
    <MidnightContext.Provider
      value={{ address, isConnected, isLoading, error, connect, disconnect, callCircuit }}
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
