import { type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { BookOpen, Code2 } from 'lucide-react';
import { WalletConnect } from './WalletConnect';
import { ConstellationBackground } from './ConstellationBackground';
import { FlowingWires } from './FlowingWires';

interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  return (
    <div className="min-h-screen bg-night-bg text-night-text">
      {/* Layered animated backgrounds */}
      <ConstellationBackground />
      <FlowingWires />

      {/* Navigation */}
      <nav className="sticky top-0 z-50 glass-nav border-b border-night-accent/10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo */}
            <motion.div
              className="flex items-center gap-2.5"
              whileHover={{ scale: 1.02 }}
              transition={{ type: 'spring', stiffness: 300 }}
            >
              <img src="/logo.svg" alt="NightScore" className="w-8 h-8" />
              <span className="text-xl font-bold bg-gradient-to-r from-night-accent via-purple-300 to-amber-300 bg-clip-text text-transparent">
                NightScore
              </span>
              <span className="hidden sm:inline-block text-[10px] text-night-muted/60 ml-1 px-2 py-0.5 rounded-full border border-night-accent/20 uppercase tracking-wider">
                Preview
              </span>
            </motion.div>

            {/* Wallet Connect (compact mode in nav) */}
            <WalletConnect compact />
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
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
      <footer className="relative z-10 border-t border-night-accent/5 py-8 mt-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <img src="/logo.svg" alt="NightScore" className="w-4 h-4" />
              <span className="text-sm font-semibold bg-gradient-to-r from-night-accent to-purple-300 bg-clip-text text-transparent">
                NightScore
              </span>
            </div>
            <p className="text-xs text-night-muted/40">
              Built on{' '}
              <a
                href="https://midnight.network"
                target="_blank"
                rel="noopener noreferrer"
                className="text-night-accent/60 hover:text-night-accent transition-colors"
              >
                Midnight
              </a>{' '}
              — Privacy-preserving credit scoring via zero-knowledge proofs
            </p>
            <div className="flex items-center gap-4">
              <a
                href="https://docs.midnight.network"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-xs text-night-muted/40 hover:text-night-muted transition-colors"
              >
                <BookOpen className="w-3.5 h-3.5" strokeWidth={1.5} />
                Docs
              </a>
              <a
                href="https://github.com"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-xs text-night-muted/40 hover:text-night-muted transition-colors"
              >
                <Code2 className="w-3.5 h-3.5" strokeWidth={1.5} />
                GitHub
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
