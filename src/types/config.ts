/**
 * Behavior Profile and configuration type definitions.
 */

export interface BehaviorProfile {
  agentId: string;
  version: number;
  parameters: Record<string, unknown>;
  lastModified: number;
}

export interface BehaviorProfileStore {
  load(agentId: string): Promise<BehaviorProfile>;
  save(profile: BehaviorProfile): Promise<void>;
  getVersionHistory(agentId: string, limit?: number): Promise<BehaviorProfile[]>;
  rollback(agentId: string, targetVersion: number): Promise<BehaviorProfile>;
  validate(agentId: string, profile: BehaviorProfile): ValidationResult;
}

export interface ValidationResult {
  valid: boolean;
  errors?: ValidationError[];
}

export interface ValidationError {
  fieldPath: string;
  constraint: string;
  rejectedValue: unknown;
}
