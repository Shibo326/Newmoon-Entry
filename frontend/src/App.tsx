import { AnimatePresence, motion } from 'framer-motion';
import { Layout } from './components/Layout';
import { WalletConnect } from './components/WalletConnect';
import { CircuitCall } from './components/CircuitCall';
import { AnimatedCard } from './components/AnimatedCard';
import { useMidnight } from './hooks/useMidnight';

export default function App() {
  const { isConnected } = useMidnight();

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
    <div className="flex flex-col items-center gap-8 py-12">
      {/* Hero Text — staggered */}
      <div className="text-center max-w-lg">
        <motion.h1
          className="text-4xl sm:text-5xl font-bold mb-4 bg-gradient-to-r from-night-text via-night-accent to-purple-300 bg-clip-text text-transparent leading-tight"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1, ease: [0.25, 0.46, 0.45, 0.94] }}
        >
          Privacy-Preserving Credit Score
        </motion.h1>
        <motion.p
          className="text-night-muted text-lg leading-relaxed"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
        >
          Prove your DeFi creditworthiness without revealing your wallet history,
          transaction patterns, or financial behavior.
        </motion.p>
      </div>

      {/* Feature Cards — staggered */}
      <motion.div
        className="grid grid-cols-1 sm:grid-cols-3 gap-4 w-full max-w-2xl"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4 }}
      >
        <AnimatedCard delay={0.45}>
          <div className="text-center">
            <div className="text-2xl mb-2">🔒</div>
            <h3 className="text-sm font-semibold text-night-text mb-1">Zero Knowledge</h3>
            <p className="text-xs text-night-muted">6 private signals computed in a ZK circuit</p>
          </div>
        </AnimatedCard>
        <AnimatedCard delay={0.55}>
          <div className="text-center">
            <div className="text-2xl mb-2">⚡</div>
            <h3 className="text-sm font-semibold text-night-text mb-1">On-Chain Proof</h3>
            <p className="text-xs text-night-muted">Score verified without revealing raw data</p>
          </div>
        </AnimatedCard>
        <AnimatedCard delay={0.65}>
          <div className="text-center">
            <div className="text-2xl mb-2">🌙</div>
            <h3 className="text-sm font-semibold text-night-text mb-1">Midnight Network</h3>
            <p className="text-xs text-night-muted">Built on Midnight&apos;s privacy-first L1</p>
          </div>
        </AnimatedCard>
      </motion.div>

      {/* Connect Prompt — delayed entrance */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.8, ease: [0.25, 0.46, 0.45, 0.94] }}
      >
        <WalletConnect />
      </motion.div>
    </div>
  );
}
