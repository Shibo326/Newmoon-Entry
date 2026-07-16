import * as __compactRuntime from '@midnight-ntwrk/compact-runtime';
__compactRuntime.checkRuntimeVersion('0.16.0');

const _descriptor_0 = new __compactRuntime.CompactTypeUnsignedInteger(4294967295n, 4);

const _descriptor_1 = new __compactRuntime.CompactTypeUnsignedInteger(65535n, 2);

const _descriptor_2 = __compactRuntime.CompactTypeBoolean;

const _descriptor_3 = new __compactRuntime.CompactTypeUnsignedInteger(255n, 1);

const _descriptor_4 = new __compactRuntime.CompactTypeUnsignedInteger(18446744073709551615n, 8);

const _descriptor_5 = new __compactRuntime.CompactTypeBytes(32);

class _Either_0 {
  alignment() {
    return _descriptor_2.alignment().concat(_descriptor_5.alignment().concat(_descriptor_5.alignment()));
  }
  fromValue(value_0) {
    return {
      is_left: _descriptor_2.fromValue(value_0),
      left: _descriptor_5.fromValue(value_0),
      right: _descriptor_5.fromValue(value_0)
    }
  }
  toValue(value_0) {
    return _descriptor_2.toValue(value_0.is_left).concat(_descriptor_5.toValue(value_0.left).concat(_descriptor_5.toValue(value_0.right)));
  }
}

const _descriptor_6 = new _Either_0();

const _descriptor_7 = new __compactRuntime.CompactTypeUnsignedInteger(340282366920938463463374607431768211455n, 16);

class _ContractAddress_0 {
  alignment() {
    return _descriptor_5.alignment();
  }
  fromValue(value_0) {
    return {
      bytes: _descriptor_5.fromValue(value_0)
    }
  }
  toValue(value_0) {
    return _descriptor_5.toValue(value_0.bytes);
  }
}

const _descriptor_8 = new _ContractAddress_0();

export class Contract {
  witnesses;
  constructor(...args_0) {
    if (args_0.length !== 1) {
      throw new __compactRuntime.CompactError(`Contract constructor: expected 1 argument, received ${args_0.length}`);
    }
    const witnesses_0 = args_0[0];
    if (typeof(witnesses_0) !== 'object') {
      throw new __compactRuntime.CompactError('first (witnesses) argument to Contract constructor is not an object');
    }
    this.witnesses = witnesses_0;
    this.circuits = {
      computeScore: (...args_1) => {
        if (args_1.length !== 7) {
          throw new __compactRuntime.CompactError(`computeScore: expected 7 arguments (as invoked from Typescript), received ${args_1.length}`);
        }
        const contextOrig_0 = args_1[0];
        const walletAge_0 = args_1[1];
        const txFrequency_0 = args_1[2];
        const defiInteractions_0 = args_1[3];
        const repaymentHistory_0 = args_1[4];
        const assetDiversity_0 = args_1[5];
        const liquidationHistory_0 = args_1[6];
        if (!(typeof(contextOrig_0) === 'object' && contextOrig_0.currentQueryContext != undefined)) {
          __compactRuntime.typeError('computeScore',
                                     'argument 1 (as invoked from Typescript)',
                                     'nightscore.compact line 36 char 1',
                                     'CircuitContext',
                                     contextOrig_0)
        }
        if (!(typeof(walletAge_0) === 'bigint' && walletAge_0 >= 0n && walletAge_0 <= 255n)) {
          __compactRuntime.typeError('computeScore',
                                     'argument 1 (argument 2 as invoked from Typescript)',
                                     'nightscore.compact line 36 char 1',
                                     'Uint<0..256>',
                                     walletAge_0)
        }
        if (!(typeof(txFrequency_0) === 'bigint' && txFrequency_0 >= 0n && txFrequency_0 <= 255n)) {
          __compactRuntime.typeError('computeScore',
                                     'argument 2 (argument 3 as invoked from Typescript)',
                                     'nightscore.compact line 36 char 1',
                                     'Uint<0..256>',
                                     txFrequency_0)
        }
        if (!(typeof(defiInteractions_0) === 'bigint' && defiInteractions_0 >= 0n && defiInteractions_0 <= 255n)) {
          __compactRuntime.typeError('computeScore',
                                     'argument 3 (argument 4 as invoked from Typescript)',
                                     'nightscore.compact line 36 char 1',
                                     'Uint<0..256>',
                                     defiInteractions_0)
        }
        if (!(typeof(repaymentHistory_0) === 'bigint' && repaymentHistory_0 >= 0n && repaymentHistory_0 <= 255n)) {
          __compactRuntime.typeError('computeScore',
                                     'argument 4 (argument 5 as invoked from Typescript)',
                                     'nightscore.compact line 36 char 1',
                                     'Uint<0..256>',
                                     repaymentHistory_0)
        }
        if (!(typeof(assetDiversity_0) === 'bigint' && assetDiversity_0 >= 0n && assetDiversity_0 <= 255n)) {
          __compactRuntime.typeError('computeScore',
                                     'argument 5 (argument 6 as invoked from Typescript)',
                                     'nightscore.compact line 36 char 1',
                                     'Uint<0..256>',
                                     assetDiversity_0)
        }
        if (!(typeof(liquidationHistory_0) === 'bigint' && liquidationHistory_0 >= 0n && liquidationHistory_0 <= 255n)) {
          __compactRuntime.typeError('computeScore',
                                     'argument 6 (argument 7 as invoked from Typescript)',
                                     'nightscore.compact line 36 char 1',
                                     'Uint<0..256>',
                                     liquidationHistory_0)
        }
        const context = { ...contextOrig_0, gasCost: __compactRuntime.emptyRunningCost() };
        const partialProofData = {
          input: {
            value: _descriptor_3.toValue(walletAge_0).concat(_descriptor_3.toValue(txFrequency_0).concat(_descriptor_3.toValue(defiInteractions_0).concat(_descriptor_3.toValue(repaymentHistory_0).concat(_descriptor_3.toValue(assetDiversity_0).concat(_descriptor_3.toValue(liquidationHistory_0)))))),
            alignment: _descriptor_3.alignment().concat(_descriptor_3.alignment().concat(_descriptor_3.alignment().concat(_descriptor_3.alignment().concat(_descriptor_3.alignment().concat(_descriptor_3.alignment())))))
          },
          output: undefined,
          publicTranscript: [],
          privateTranscriptOutputs: []
        };
        const result_0 = this._computeScore_0(context,
                                              partialProofData,
                                              walletAge_0,
                                              txFrequency_0,
                                              defiInteractions_0,
                                              repaymentHistory_0,
                                              assetDiversity_0,
                                              liquidationHistory_0);
        partialProofData.output = { value: [], alignment: [] };
        return { result: result_0, context: context, proofData: partialProofData, gasCost: context.gasCost };
      },
      verifyThreshold: (...args_1) => {
        if (args_1.length !== 3) {
          throw new __compactRuntime.CompactError(`verifyThreshold: expected 3 arguments (as invoked from Typescript), received ${args_1.length}`);
        }
        const contextOrig_0 = args_1[0];
        const actualScore_0 = args_1[1];
        const minimumScore_0 = args_1[2];
        if (!(typeof(contextOrig_0) === 'object' && contextOrig_0.currentQueryContext != undefined)) {
          __compactRuntime.typeError('verifyThreshold',
                                     'argument 1 (as invoked from Typescript)',
                                     'nightscore.compact line 61 char 1',
                                     'CircuitContext',
                                     contextOrig_0)
        }
        if (!(typeof(actualScore_0) === 'bigint' && actualScore_0 >= 0n && actualScore_0 <= 65535n)) {
          __compactRuntime.typeError('verifyThreshold',
                                     'argument 1 (argument 2 as invoked from Typescript)',
                                     'nightscore.compact line 61 char 1',
                                     'Uint<0..65536>',
                                     actualScore_0)
        }
        if (!(typeof(minimumScore_0) === 'bigint' && minimumScore_0 >= 0n && minimumScore_0 <= 65535n)) {
          __compactRuntime.typeError('verifyThreshold',
                                     'argument 2 (argument 3 as invoked from Typescript)',
                                     'nightscore.compact line 61 char 1',
                                     'Uint<0..65536>',
                                     minimumScore_0)
        }
        const context = { ...contextOrig_0, gasCost: __compactRuntime.emptyRunningCost() };
        const partialProofData = {
          input: {
            value: _descriptor_1.toValue(actualScore_0).concat(_descriptor_1.toValue(minimumScore_0)),
            alignment: _descriptor_1.alignment().concat(_descriptor_1.alignment())
          },
          output: undefined,
          publicTranscript: [],
          privateTranscriptOutputs: []
        };
        const result_0 = this._verifyThreshold_0(context,
                                                 partialProofData,
                                                 actualScore_0,
                                                 minimumScore_0);
        partialProofData.output = { value: [], alignment: [] };
        return { result: result_0, context: context, proofData: partialProofData, gasCost: context.gasCost };
      }
    };
    this.impureCircuits = {
      computeScore: this.circuits.computeScore,
      verifyThreshold: this.circuits.verifyThreshold
    };
    this.provableCircuits = {
      computeScore: this.circuits.computeScore,
      verifyThreshold: this.circuits.verifyThreshold
    };
  }
  initialState(...args_0) {
    if (args_0.length !== 1) {
      throw new __compactRuntime.CompactError(`Contract state constructor: expected 1 argument (as invoked from Typescript), received ${args_0.length}`);
    }
    const constructorContext_0 = args_0[0];
    if (typeof(constructorContext_0) !== 'object') {
      throw new __compactRuntime.CompactError(`Contract state constructor: expected 'constructorContext' in argument 1 (as invoked from Typescript) to be an object`);
    }
    if (!('initialZswapLocalState' in constructorContext_0)) {
      throw new __compactRuntime.CompactError(`Contract state constructor: expected 'initialZswapLocalState' in argument 1 (as invoked from Typescript)`);
    }
    if (typeof(constructorContext_0.initialZswapLocalState) !== 'object') {
      throw new __compactRuntime.CompactError(`Contract state constructor: expected 'initialZswapLocalState' in argument 1 (as invoked from Typescript) to be an object`);
    }
    const state_0 = new __compactRuntime.ContractState();
    let stateValue_0 = __compactRuntime.StateValue.newArray();
    stateValue_0 = stateValue_0.arrayPush(__compactRuntime.StateValue.newNull());
    stateValue_0 = stateValue_0.arrayPush(__compactRuntime.StateValue.newNull());
    stateValue_0 = stateValue_0.arrayPush(__compactRuntime.StateValue.newNull());
    state_0.data = new __compactRuntime.ChargedState(stateValue_0);
    state_0.setOperation('computeScore', new __compactRuntime.ContractOperation());
    state_0.setOperation('verifyThreshold', new __compactRuntime.ContractOperation());
    const context = __compactRuntime.createCircuitContext(__compactRuntime.dummyContractAddress(), constructorContext_0.initialZswapLocalState.coinPublicKey, state_0.data, constructorContext_0.initialPrivateState);
    const partialProofData = {
      input: { value: [], alignment: [] },
      output: undefined,
      publicTranscript: [],
      privateTranscriptOutputs: []
    };
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_3.toValue(0n),
                                                                                              alignment: _descriptor_3.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_1.toValue(0n),
                                                                                              alignment: _descriptor_1.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_3.toValue(1n),
                                                                                              alignment: _descriptor_3.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_2.toValue(false),
                                                                                              alignment: _descriptor_2.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_3.toValue(2n),
                                                                                              alignment: _descriptor_3.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_0.toValue(0n),
                                                                                              alignment: _descriptor_0.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    state_0.data = new __compactRuntime.ChargedState(context.currentQueryContext.state.state);
    return {
      currentContractState: state_0,
      currentPrivateState: context.currentPrivateState,
      currentZswapLocalState: context.currentZswapLocalState
    }
  }
  _computeScore_0(context,
                  partialProofData,
                  walletAge_0,
                  txFrequency_0,
                  defiInteractions_0,
                  repaymentHistory_0,
                  assetDiversity_0,
                  liquidationHistory_0)
  {
    const tmp_0 = walletAge_0 * 20n + txFrequency_0 * 15n
                  +
                  defiInteractions_0 * 15n
                  +
                  repaymentHistory_0 * 25n
                  +
                  assetDiversity_0 * 15n
                  +
                  liquidationHistory_0 * 10n;
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_3.toValue(0n),
                                                                                              alignment: _descriptor_3.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_1.toValue(tmp_0),
                                                                                              alignment: _descriptor_1.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_3.toValue(1n),
                                                                                              alignment: _descriptor_3.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_2.toValue(true),
                                                                                              alignment: _descriptor_2.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    const tmp_1 = ((t1) => {
                    if (t1 > 4294967295n) {
                      throw new __compactRuntime.CompactError('nightscore.compact line 53 char 26: cast from Field or Uint value to smaller Uint value failed: ' + t1 + ' is greater than 4294967295');
                    }
                    return t1;
                  })(_descriptor_0.fromValue(__compactRuntime.queryLedgerState(context,
                                                                               partialProofData,
                                                                               [
                                                                                { dup: { n: 0 } },
                                                                                { idx: { cached: false,
                                                                                         pushPath: false,
                                                                                         path: [
                                                                                                { tag: 'value',
                                                                                                  value: { value: _descriptor_3.toValue(2n),
                                                                                                           alignment: _descriptor_3.alignment() } }] } },
                                                                                { popeq: { cached: false,
                                                                                           result: undefined } }]).value)
                     +
                     1n);
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_3.toValue(2n),
                                                                                              alignment: _descriptor_3.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_0.toValue(tmp_1),
                                                                                              alignment: _descriptor_0.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    return [];
  }
  _verifyThreshold_0(context, partialProofData, actualScore_0, minimumScore_0) {
    const tmp_0 = actualScore_0 >= minimumScore_0;
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_3.toValue(1n),
                                                                                              alignment: _descriptor_3.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_2.toValue(tmp_0),
                                                                                              alignment: _descriptor_2.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    return [];
  }
}
export function ledger(stateOrChargedState) {
  const state = stateOrChargedState instanceof __compactRuntime.StateValue ? stateOrChargedState : stateOrChargedState.state;
  const chargedState = stateOrChargedState instanceof __compactRuntime.StateValue ? new __compactRuntime.ChargedState(stateOrChargedState) : stateOrChargedState;
  const context = {
    currentQueryContext: new __compactRuntime.QueryContext(chargedState, __compactRuntime.dummyContractAddress()),
    costModel: __compactRuntime.CostModel.initialCostModel()
  };
  const partialProofData = {
    input: { value: [], alignment: [] },
    output: undefined,
    publicTranscript: [],
    privateTranscriptOutputs: []
  };
  return {
    get score() {
      return _descriptor_1.fromValue(__compactRuntime.queryLedgerState(context,
                                                                       partialProofData,
                                                                       [
                                                                        { dup: { n: 0 } },
                                                                        { idx: { cached: false,
                                                                                 pushPath: false,
                                                                                 path: [
                                                                                        { tag: 'value',
                                                                                          value: { value: _descriptor_3.toValue(0n),
                                                                                                   alignment: _descriptor_3.alignment() } }] } },
                                                                        { popeq: { cached: false,
                                                                                   result: undefined } }]).value);
    },
    get registered() {
      return _descriptor_2.fromValue(__compactRuntime.queryLedgerState(context,
                                                                       partialProofData,
                                                                       [
                                                                        { dup: { n: 0 } },
                                                                        { idx: { cached: false,
                                                                                 pushPath: false,
                                                                                 path: [
                                                                                        { tag: 'value',
                                                                                          value: { value: _descriptor_3.toValue(1n),
                                                                                                   alignment: _descriptor_3.alignment() } }] } },
                                                                        { popeq: { cached: false,
                                                                                   result: undefined } }]).value);
    },
    get totalScored() {
      return _descriptor_0.fromValue(__compactRuntime.queryLedgerState(context,
                                                                       partialProofData,
                                                                       [
                                                                        { dup: { n: 0 } },
                                                                        { idx: { cached: false,
                                                                                 pushPath: false,
                                                                                 path: [
                                                                                        { tag: 'value',
                                                                                          value: { value: _descriptor_3.toValue(2n),
                                                                                                   alignment: _descriptor_3.alignment() } }] } },
                                                                        { popeq: { cached: false,
                                                                                   result: undefined } }]).value);
    }
  };
}
const _emptyContext = {
  currentQueryContext: new __compactRuntime.QueryContext(new __compactRuntime.ContractState().data, __compactRuntime.dummyContractAddress())
};
const _dummyContract = new Contract({ });
export const pureCircuits = {};
export const contractReferenceLocations =
  { tag: 'publicLedgerArray', indices: { } };
//# sourceMappingURL=index.js.map
