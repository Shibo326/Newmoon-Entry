import { useState, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ShieldCheck, Fingerprint, Moon } from 'lucide-react';
import { Layout } from './components/Layout';
import { WalletConnect } from './components/WalletConnect';
import { CircuitCall } from './components/CircuitCall';
import { ThresholdVerify } from './components/ThresholdVerify';
import { AnimatedCard } from './components/AnimatedCard';
import { LoadingScreen } from './components/LoadingScreen';
import { useMidnight } from './hooks/useMidnight';

export default function App() {
  const { isConnected } = useMidnight();
  const [isLoading, setIsLoading] = useState(true);

  const handleLoadingComplete = useCallback(() => {
    setIsLoading(false);
  }, []);

  if (isLoading) {
    return <LoadingScreen onComplete={handleLoadingComplete} />;
  }

  return (
    <Layout>
      <AnimatePresence mode="wait">
        {isConnected ? (
          <motion.div
            key="circuit"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] }}
          >
            <CircuitCall />
            <ThresholdVerify />
          </motion.div>
        ) : (
          <motion.div
            key="hero"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.35 }}
          >
            <HeroSection />
          </motion.div>
        )}
      </AnimatePresence>
    </Layout>
  );
}

function HeroSection() {
  return (
    <div className="flex flex-col items-center gap-12 py-16">
      {/* Hero Text — large bold like Lace */}
      <div className="text-center max-w-2xl">
        <motion.h1
          className="text-5xl sm:text-6xl lg:text-7xl font-bold mb-6 leading-[1.1] tracking-tight"
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.1, ease: [0.25, 0.46, 0.45, 0.94] }}
        >
          <span className="bg-gradient-to-r from-white via-night-text to-night-muted/80 bg-clip-text text-transparent">
            The private way to
          </span>
          <br />
          <span className="bg-gradient-to-r from-night-accent via-purple-300 to-amber-300 bg-clip-text text-transparent">
            prove your score
          </span>
        </motion.h1>
        <motion.p
          className="text-night-muted text-lg sm:text-xl leading-relaxed max-w-lg mx-auto"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }}
        >
          Prove your DeFi creditworthiness without revealing your wallet history,
          transaction patterns, or financial behavior.
        </motion.p>
      </div>

      {/* Feature Cards — staggered */}
      <motion.div
        className="grid grid-cols-1 sm:grid-cols-3 gap-5 w-full max-w-3xl"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
      >
        <AnimatedCard delay={0.55}>
          <div className="text-center p-2">
            <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-night-accent/10 border border-night-accent/20 flex items-center justify-center">
              <ShieldCheck className="w-6 h-6 text-night-accent" strokeWidth={1.5} />
            </div>
            <h3 className="text-sm font-semibold text-night-text mb-1.5">Zero Knowledge</h3>
            <p className="text-xs text-night-muted leading-relaxed">6 private signals computed in a ZK circuit — nothing revealed on-chain</p>
          </div>
        </AnimatedCard>
        <AnimatedCard delay={0.65}>
          <div className="text-center p-2">
            <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
              <Fingerprint className="w-6 h-6 text-amber-400" strokeWidth={1.5} />
            </div>
            <h3 className="text-sm font-semibold text-night-text mb-1.5">On-Chain Proof</h3>
            <p className="text-xs text-night-muted leading-relaxed">Score verified cryptographically without exposing raw data</p>
          </div>
        </AnimatedCard>
        <AnimatedCard delay={0.75}>
          <div className="text-center p-2">
            <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center">
              <Moon className="w-6 h-6 text-purple-400" strokeWidth={1.5} />
            </div>
            <h3 className="text-sm font-semibold text-night-text mb-1.5">Midnight Network</h3>
            <p className="text-xs text-night-muted leading-relaxed">Built on Midnight&apos;s privacy-first Layer 1 blockchain</p>
          </div>
        </AnimatedCard>
      </motion.div>

      {/* Connect Prompt — delayed entrance */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.9, ease: [0.25, 0.46, 0.45, 0.94] }}
      >
        <WalletConnect />
      </motion.div>

      {/* Trust indicators */}
      <motion.div
        className="flex flex-wrap items-center justify-center gap-6 pt-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.2 }}
      >
        <div className="flex items-center gap-2 text-night-muted/40 text-xs">
          <div className="w-1.5 h-1.5 rounded-full bg-green-400/60" />
          <span>Midnight Testnet Live</span>
        </div>
        <div className="flex items-center gap-2 text-night-muted/40 text-xs">
          <div className="w-1.5 h-1.5 rounded-full bg-night-accent/60" />
          <span>ZK Proofs Enabled</span>
        </div>
        <div className="flex items-center gap-2 text-night-muted/40 text-xs">
          <div className="w-1.5 h-1.5 rounded-full bg-amber-400/60" />
          <span>Lace Wallet Compatible</span>
        </div>
      </motion.div>
    </div>
  );
}
