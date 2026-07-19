import { type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { WalletConnect } from './WalletConnect';
import { ConstellationBackground } from './ConstellationBackground';

interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  return (
    <div className="min-h-screen bg-night-bg text-night-text">
      {/* Constellation particle background */}
      <ConstellationBackground />

      {/* Navigation */}
      <nav className="sticky top-0 z-50 glass border-b border-night-accent/10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo */}
            <div className="flex items-center gap-2">
              <span className="text-2xl">🌙</span>
              <span className="text-xl font-bold bg-gradient-to-r from-night-accent to-purple-300 bg-clip-text text-transparent">
                NightScore
              </span>
              <span className="hidden sm:inline-block text-xs text-night-muted/60 ml-2 px-2 py-0.5 rounded-full border border-night-muted/20">
                Preview
              </span>
              <span className="hidden sm:inline-block text-xs text-night-accent/60 ml-1 px-2 py-0.5 rounded-full border border-night-accent/20">
                ZK-Powered
              </span>
            </div>

            {/* Wallet Connect (compact mode in nav) */}
            <WalletConnect compact />
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <AnimatePresence mode="wait">
          <motion.div
            key="page-content"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }}
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Footer */}
      <footer className="relative z-10 border-t border-night-accent/10 py-6 mt-12">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <p className="text-xs text-night-muted/50">
            Built on{' '}
            <a
              href="https://midnight.network"
              target="_blank"
              rel="noopener noreferrer"
              className="text-night-accent/70 hover:text-night-accent"
            >
              Midnight
            </a>{' '}
            — Privacy-preserving credit scoring via zero-knowledge proofs
          </p>
        </div>
      </footer>
    </div>
  );
}
