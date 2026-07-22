import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShieldCheck, ShieldX, Eye, EyeOff } from 'lucide-react';
import { useMidnight } from '../hooks/useMidnight';
import { AnimatedButton } from './AnimatedButton';
import { AnimatedCard } from './AnimatedCard';
import { FadeInSection } from './FadeInSection';
import type { ThresholdResult } from '../services/midnight-provider';

/**
 * Grade thresholds for UI display.
 * Score ranges based on weighted formula (max possible = 25500).
 */
const GRADE_THRESHOLDS = [
  { grade: 'AAA', minScore: 20000, description: 'Exceptional — top-tier DeFi reputation' },
  { grade: 'AA', minScore: 15000, description: 'Excellent — strong on-chain history' },
  { grade: 'A', minScore: 10000, description: 'Good — reliable DeFi participant' },
  { grade: 'BBB', minScore: 6000, description: 'Adequate — meets basic requirements' },
  { grade: 'BB', minScore: 3000, description: 'Below average — limited history' },
  { grade: 'C', minScore: 0, description: 'Minimal — new or inactive wallet' },
];

export function ThresholdVerify() {
  const { verifyThreshold, isLoading } = useMidnight();
  const [selectedGrade, setSelectedGrade] = useState<string>('BBB');
  const [scoreToVerify, setScoreToVerify] = useState<number>(8500);
  const [result, setResult] = useState<ThresholdResult | null>(null);
  const [verifyState, setVerifyState] = useState<'idle' | 'verifying' | 'done'>('idle');

  const selectedThreshold = GRADE_THRESHOLDS.find((g) => g.grade === selectedGrade);

  const handleVerify = async () => {
    if (!selectedThreshold) return;
    setVerifyState('verifying');
    setResult(null);

    try {
      const thresholdResult = await verifyThreshold(scoreToVerify, selectedThreshold.minScore);
      setResult(thresholdResult);
      setVerifyState('done');
    } catch {
      setVerifyState('idle');
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto mt-8">
      <FadeInSection delay={0}>
        <div className="glass rounded-2xl p-6">
          {/* Header */}
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center">
              <EyeOff className="w-5 h-5 text-purple-400" strokeWidth={1.5} />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-night-text">
                Threshold Verification
              </h3>
              <p className="text-xs text-night-muted">
                Prove you meet a grade without revealing your actual score
              </p>
            </div>
          </div>

          {/* Privacy Explanation */}
          <div className="mb-5 px-3 py-2 rounded-lg bg-purple-500/5 border border-purple-500/15 text-purple-300/80 text-xs">
            <div className="flex items-start gap-2">
              <Eye className="w-4 h-4 mt-0.5 shrink-0" strokeWidth={1.5} />
              <div>
                <span className="font-medium">What the verifier sees:</span> only true/false.
                <br />
                <span className="font-medium">What stays private:</span> your actual score, signals, and grade.
              </div>
            </div>
          </div>

          {/* Score Input */}
          <div className="mb-4">
            <label className="text-xs text-night-muted block mb-1">
              Your Score (private — never revealed to verifier)
            </label>
            <input
              type="number"
              min={0}
              max={25500}
              value={scoreToVerify}
              onChange={(e) => setScoreToVerify(Math.max(0, Math.min(25500, parseInt(e.target.value) || 0)))}
              className="w-full px-3 py-2 bg-night-bg border border-night-accent/20 rounded-lg text-night-text text-sm focus:outline-none focus:border-night-accent/50 transition-colors"
            />
          </div>

          {/* Grade Selection */}
          <div className="mb-5">
            <label className="text-xs text-night-muted block mb-2">
              Minimum Grade to Verify Against
            </label>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              {GRADE_THRESHOLDS.map((grade) => (
                <button
                  key={grade.grade}
                  onClick={() => setSelectedGrade(grade.grade)}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                    selectedGrade === grade.grade
                      ? 'bg-night-accent/20 border-night-accent/50 text-night-accent border'
                      : 'bg-night-bg border border-night-accent/10 text-night-muted hover:border-night-accent/30'
                  }`}
                >
                  {grade.grade}
                </button>
              ))}
            </div>
            {selectedThreshold && (
              <p className="text-xs text-night-muted/60 mt-2">
                {selectedThreshold.description} (min score: {selectedThreshold.minScore.toLocaleString()})
              </p>
            )}
          </div>

          {/* Verify Button */}
          <AnimatedButton
            variant="secondary"
            onClick={handleVerify}
            disabled={isLoading || verifyState === 'verifying'}
            fullWidth
            className="px-5 py-3"
          >
            {verifyState === 'verifying' ? (
              <span className="flex items-center justify-center gap-2">
                <VerifySpinner />
                Generating ZK proof...
              </span>
            ) : (
              <span className="flex items-center justify-center gap-2">
                <ShieldCheck className="w-4 h-4" strokeWidth={1.5} />
                Verify Threshold (Boolean Only)
              </span>
            )}
          </AnimatedButton>

          {/* Result */}
          <AnimatePresence>
            {verifyState === 'done' && result && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="mt-5"
              >
                <AnimatedCard delay={0}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {result.meetsThreshold ? (
                        <div className="w-10 h-10 rounded-xl bg-green-500/10 border border-green-500/30 flex items-center justify-center">
                          <ShieldCheck className="w-5 h-5 text-green-400" strokeWidth={1.5} />
                        </div>
                      ) : (
                        <div className="w-10 h-10 rounded-xl bg-red-500/10 border border-red-500/30 flex items-center justify-center">
                          <ShieldX className="w-5 h-5 text-red-400" strokeWidth={1.5} />
                        </div>
                      )}
                      <div>
                        <div className={`text-lg font-bold ${result.meetsThreshold ? 'text-green-400' : 'text-red-400'}`}>
                          {result.meetsThreshold ? 'TRUE' : 'FALSE'}
                        </div>
                        <div className="text-xs text-night-muted">
                          {result.meetsThreshold
                            ? `Wallet meets ${selectedGrade} threshold`
                            : `Wallet does NOT meet ${selectedGrade} threshold`}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-night-muted/60">
                        {new Date(result.queriedAt).toLocaleTimeString()}
                      </div>
                    </div>
                  </div>

                  {/* Privacy proof */}
                  <div className="mt-3 pt-3 border-t border-night-accent/10">
                    <div className="flex items-center gap-2 text-xs text-green-300/70">
                      <EyeOff className="w-3.5 h-3.5" strokeWidth={1.5} />
                      <span>Verifier received only the boolean — your score remains private</span>
                    </div>
                  </div>
                </AnimatedCard>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </FadeInSection>
    </div>
  );
}

function VerifySpinner() {
  return (
    <svg
      className="animate-spin h-4 w-4"
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
