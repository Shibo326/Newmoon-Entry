/**
 * Types for the NightGuard AI Security Agent.
 * Handles transaction screening, phishing detection,
 * and behavioral anomaly detection.
 */

/** Risk level classification for a transaction */
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

/** A single risk factor identified by the AI */
export interface RiskFactor {
  category: 'contract_age' | 'unlimited_approval' | 'known_exploit' | 'anomaly' | 'phishing' | 'high_value' | 'score_impact';
  severity: RiskLevel;
  description: string;
}

/** The full security assessment for a transaction */
export interface SecurityAssessment {
  overallRisk: RiskLevel;
  riskScore: number; // 0-100, higher = riskier
  factors: RiskFactor[];
  recommendation: 'proceed' | 'caution' | 'block';
  summary: string;
  timestamp: number;
}

/** Transaction data to be screened */
export interface TransactionRequest {
  to: string;
  from: string;
  value?: string;
  data?: string;
  contractName?: string;
  contractAge?: number; // days since deployment
  isVerified?: boolean;
  functionName?: string;
  /** Whether this is an approval/allowance transaction */
  isApproval?: boolean;
  approvalAmount?: string; // 'unlimited' or numeric
}

/** Context about the user's wallet for behavioral analysis */
export interface WalletContext {
  knownInteractions: string[]; // addresses previously interacted with
  averageTransactionValue?: string;
  currentNightScore?: number;
  currentGrade?: string;
}

/** Fireworks AI client interface for testability */
export interface FireworksClient {
  analyze(prompt: string, systemPrompt: string): Promise<string>;
}

/** Topics handled by the Guard Agent */
export type GuardTopic = 
  | 'guard.screen-transaction'
  | 'guard.check-phishing'
  | 'guard.assess-score-impact';
