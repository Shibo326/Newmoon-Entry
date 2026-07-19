import { useMidnightContext } from '../context/MidnightContext';
import type { CircuitResult } from '../services/midnight-provider';

interface UseMidnightReturn {
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

export function useMidnight(): UseMidnightReturn {
  return useMidnightContext();
}
