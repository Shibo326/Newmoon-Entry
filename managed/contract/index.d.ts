import type * as __compactRuntime from '@midnight-ntwrk/compact-runtime';

export type Witnesses<PS> = {
}

export type ImpureCircuits<PS> = {
  computeScore(context: __compactRuntime.CircuitContext<PS>,
               walletAge_0: bigint,
               txFrequency_0: bigint,
               defiInteractions_0: bigint,
               repaymentHistory_0: bigint,
               assetDiversity_0: bigint,
               liquidationHistory_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  verifyThreshold(context: __compactRuntime.CircuitContext<PS>,
                  actualScore_0: bigint,
                  minimumScore_0: bigint): __compactRuntime.CircuitResults<PS, []>;
}

export type ProvableCircuits<PS> = {
  computeScore(context: __compactRuntime.CircuitContext<PS>,
               walletAge_0: bigint,
               txFrequency_0: bigint,
               defiInteractions_0: bigint,
               repaymentHistory_0: bigint,
               assetDiversity_0: bigint,
               liquidationHistory_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  verifyThreshold(context: __compactRuntime.CircuitContext<PS>,
                  actualScore_0: bigint,
                  minimumScore_0: bigint): __compactRuntime.CircuitResults<PS, []>;
}

export type PureCircuits = {
}

export type Circuits<PS> = {
  computeScore(context: __compactRuntime.CircuitContext<PS>,
               walletAge_0: bigint,
               txFrequency_0: bigint,
               defiInteractions_0: bigint,
               repaymentHistory_0: bigint,
               assetDiversity_0: bigint,
               liquidationHistory_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  verifyThreshold(context: __compactRuntime.CircuitContext<PS>,
                  actualScore_0: bigint,
                  minimumScore_0: bigint): __compactRuntime.CircuitResults<PS, []>;
}

export type Ledger = {
  readonly score: bigint;
  readonly registered: boolean;
  readonly totalScored: bigint;
}

export type ContractReferenceLocations = any;

export declare const contractReferenceLocations : ContractReferenceLocations;

export declare class Contract<PS = any, W extends Witnesses<PS> = Witnesses<PS>> {
  witnesses: W;
  circuits: Circuits<PS>;
  impureCircuits: ImpureCircuits<PS>;
  provableCircuits: ProvableCircuits<PS>;
  constructor(witnesses: W);
  initialState(context: __compactRuntime.ConstructorContext<PS>): __compactRuntime.ConstructorResult<PS>;
}

export declare function ledger(state: __compactRuntime.StateValue | __compactRuntime.ChargedState): Ledger;
export declare const pureCircuits: PureCircuits;
