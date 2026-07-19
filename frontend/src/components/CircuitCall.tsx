import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useMidnight } from '../hooks/useMidnight';
import { AnimatedButton } from './AnimatedButton';
import { AnimatedCard } from './AnimatedCard';
import { FadeInSection } from './FadeInSection';
import type { CircuitResult } from '../services/midnight-provider';

const CONTRACT_ADDRESS = 'a3e01772c31935fc25719d878514b2bb1b64198c65b4862dd9fcb6888173af71';

interface SignalInput {
  label: string;
  key: string;
  placeholder: string;
  max: number;
}

const SIGNAL_INPUTS: SignalInput[] = [
  { label: 'Wallet Age (days)', key: 'walletAge', placeholder: '0–255', max: 255 },
  { label: 'TX Frequency', key: 'txFrequency', placeholder: '0–255', max: 255 },
  { label: 'DeFi Interactions', key: 'defiInteractions', placeholder: '0–255', max: 255 },
  { label: 'Repayment History (%)', key: 'repaymentHistory', placeholder: '0–100', max: 100 },
  { label: 'Asset Diversity', key: 'assetDiversity', placeholder: '0–255', max: 255 },
  { label: 'Liquidation Events', key: 'liquidationHistory', placeholder: '0–255', max: 255 },
];

function NumberTicker({ value, duration = 1.2 }: { value: number; duration?: number }) {
  const [displayed, setDisplayed] = useState(0);
  const startTime = useRef<number | null>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    startTime.current = null;

    function tick(timestamp: number) {
      if (startTime.current === null) startTime.current = timestamp;
      const elapsed = timestamp - startTime.current;
      const progress = Math.min(elapsed / (duration * 1000), 1);

      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayed(Math.round(eased * value));

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      }
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [value, duration]);

  return <>{displayed}</>;
}

export function CircuitCall() {
  const { callCircuit, isLoading, error } = useMidnight();
  const [inputs, setInputs] = useState<Record<string, number>>({
    walletAge: 120,
    txFrequency: 85,
    defiInteractions: 45,
    repaymentHistory: 92,
    assetDiversity: 12,
    liquidationHistory: 2,
  });
  const [result, setResult] = useState<CircuitResult | null>(null);
  const [proofState, setProofState] = useState<'idle' | 'proving' | 'done' | 'error'>('idle');

  const handleInputChange = (key: string, value: string) => {
    const num = Math.max(0, Math.min(255, parseInt(value) || 0));
    setInputs((prev) => ({ ...prev, [key]: num }));
  };

  const handleCompute = async () => {
    setProofState('proving');
    setResult(null);

    try {
      const circuitResult = await callCircuit({
        walletAge: inputs.walletAge,
        txFrequency: inputs.txFrequency,
        defiInteractions: inputs.defiInteractions,
        repaymentHistory: inputs.repaymentHistory,
        assetDiversity: inputs.assetDiversity,
        liquidationHistory: inputs.liquidationHistory,
      });
      setResult(circuitResult);
      setProofState('done');
    } catch {
      setProofState('error');
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto">
      {/* Demo Mode Banner */}
      <FadeInSection delay={0}>
        <div className="mb-6 px-4 py-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-sm text-center">
          🔧 Demo Mode — Connect to Midnight Preprod for live proofs
        </div>
      </FadeInSection>

      {/* Privacy Notice */}
      <FadeInSection delay={0.05}>
        <div className="mb-6 px-4 py-3 rounded-xl bg-green-500/5 border border-green-500/20 text-green-300/80 text-xs text-center">
          🔒 Your 6 private signals are computed locally via ZK circuit — they never leave your device or appear on-chain
        </div>
      </FadeInSection>

      {/* Contract Info */}
      <FadeInSection delay={0.1}>
        <AnimatedCard className="mb-6" delay={0.1}>
          <div className="flex items-center justify-between">
            <span className="text-xs text-night-muted">Contract (Preview)</span>
            <span className="text-xs font-mono text-night-muted/70 truncate ml-2">
              {CONTRACT_ADDRESS.slice(0, 16)}...{CONTRACT_ADDRESS.slice(-8)}
            </span>
          </div>
        </AnimatedCard>
      </FadeInSection>

      {/* Input Form */}
      <FadeInSection delay={0.2}>
        <div className="glass rounded-2xl p-6 mb-6">
          <h3 className="text-lg font-semibold text-night-text mb-1">
            Private Signal Inputs
          </h3>
          <p className="text-xs text-night-muted mb-4">
            These values stay on your device. Only the computed score goes on-chain.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {SIGNAL_INPUTS.map((signal, i) => (
              <motion.div
                key={signal.key}
                className="flex flex-col gap-1"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  duration: 0.35,
                  delay: 0.3 + i * 0.06,
                  ease: [0.25, 0.46, 0.45, 0.94],
                }}
              >
                <label className="text-xs text-night-muted">{signal.label}</label>
                <input
                  type="number"
                  min={0}
                  max={signal.max}
                  value={inputs[signal.key]}
                  onChange={(e) => handleInputChange(signal.key, e.target.value)}
                  placeholder={signal.placeholder}
                  className="px-3 py-2 bg-night-bg border border-night-accent/20 rounded-lg text-night-text text-sm focus:outline-none focus:border-night-accent/50 transition-colors"
                />
              </motion.div>
            ))}
          </div>
        </div>
      </FadeInSection>

      {/* Compute Button */}
      <FadeInSection delay={0.5}>
        <div className="mb-6">
          <AnimatedButton
            variant="primary"
            onClick={handleCompute}
            disabled={isLoading || proofState === 'proving'}
            fullWidth
            className="px-6 py-4 text-lg"
          >
            {proofState === 'proving' ? (
              <span className="flex items-center justify-center gap-3">
                <ProofSpinner />
                Generating zero-knowledge proof...
              </span>
            ) : (
              'Compute Credit Score'
            )}
          </AnimatedButton>
        </div>
      </FadeInSection>

      {/* Proof generation pulsing state */}
      <AnimatePresence>
        {proofState === 'proving' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="mb-6"
          >
            <motion.div
              className="glass rounded-2xl p-6 text-center"
              animate={{
                boxShadow: [
                  '0 0 0px rgba(139, 92, 246, 0)',
                  '0 0 30px rgba(139, 92, 246, 0.2)',
                  '0 0 0px rgba(139, 92, 246, 0)',
                ],
              }}
              transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
            >
              <p className="text-night-muted text-sm">
                Building ZK circuit proof...
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Result Display */}
      <AnimatePresence>
        {proofState === 'done' && result && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ type: 'spring', stiffness: 200, damping: 20 }}
            className="glass rounded-2xl p-6 animate-pulse-glow"
          >
            <div className="text-center mb-4">
              <div className="text-5xl font-bold text-night-accent mb-2">
                <NumberTicker value={result.score} />
              </div>
              <div className="text-sm text-night-muted">Weighted Credit Score</div>
            </div>

            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.8, duration: 0.4, ease: 'easeOut' }}
              className="flex items-center justify-center gap-2 mb-4 px-3 py-2 rounded-lg bg-green-500/10 border border-green-500/30"
            >
              <span className="text-green-400">✓</span>
              <span className="text-green-300 text-sm">
                Proved without revealing your private signals
              </span>
            </motion.div>

            <div className="space-y-2 text-xs">
              <div className="flex items-start gap-2">
                <span className="text-night-muted shrink-0">Proof Hash:</span>
                <span className="font-mono text-night-text/80 break-all">
                  {result.proofHash}
                </span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-night-muted shrink-0">TX Hash:</span>
                <span className="font-mono text-night-text/80 break-all">
                  {result.txHash}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-night-muted">Timestamp:</span>
                <span className="text-night-text/80">
                  {new Date(result.timestamp).toLocaleString()}
                </span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Error State */}
      <AnimatePresence>
        {(proofState === 'error' || error) && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="glass rounded-2xl p-6 border-red-500/30"
          >
            <div className="text-center">
              <div className="text-3xl mb-2">⚠️</div>
              <p className="text-red-400 mb-4">{error || 'Proof generation failed'}</p>
              <AnimatedButton
                variant="secondary"
                onClick={handleCompute}
                className="px-5 py-2"
              >
                Retry
              </AnimatedButton>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ProofSpinner() {
  return (
    <svg
      className="animate-spin h-5 w-5"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}
