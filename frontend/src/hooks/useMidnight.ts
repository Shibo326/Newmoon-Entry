import { useMidnightContext } from '../context/MidnightContext';
import type { CircuitResult, ThresholdResult, ContractLedgerState } from '../services/midnight-provider';

interface UseMidnightReturn {
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

export function useMidnight(): UseMidnightReturn {
  return useMidnightContext();
}
