import { motion } from 'framer-motion';
import { useMidnight } from '../hooks/useMidnight';
import { AnimatedButton } from './AnimatedButton';

interface WalletConnectProps {
  compact?: boolean;
}

export function WalletConnect({ compact = false }: WalletConnectProps) {
  const { address, isConnected, isLoading, error, connect, disconnect } = useMidnight();

  const truncateAddress = (addr: string) =>
    `${addr.slice(0, 6)}...${addr.slice(-4)}`;

  if (isConnected && address) {
    return (
      <motion.div
        className="flex items-center gap-3"
        initial={{ opacity: 0, x: 10 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.3 }}
      >
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-night-card border border-night-accent/20">
          <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          <span className="text-sm text-night-muted font-mono">
            {truncateAddress(address)}
          </span>
        </div>
        <AnimatedButton
          variant="ghost"
          onClick={disconnect}
          className="px-3 py-1.5 text-sm"
        >
          Disconnect
        </AnimatedButton>
      </motion.div>
    );
  }

  if (compact) {
    return (
      <div className="flex flex-col items-center gap-2">
        <AnimatedButton
          variant="primary"
          onClick={connect}
          disabled={isLoading}
          className="px-5 py-2"
        >
          {isLoading ? (
            <span className="flex items-center gap-2">
              <Spinner />
              Connecting...
            </span>
          ) : (
            'Connect Wallet'
          )}
        </AnimatedButton>
        {error && <ErrorMessage message={error} />}
      </div>
    );
  }

  return (
    <motion.div
      className="flex flex-col items-center gap-6"
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
    >
      <div className="glass rounded-2xl p-8 max-w-md w-full text-center">
        {/* Floating moon emoji */}
        <motion.div
          className="text-5xl mb-4"
          animate={{ y: [0, -6, 0] }}
          transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
        >
          🌙
        </motion.div>

        <h2 className="text-2xl font-bold text-night-text mb-2">
          Connect Your Wallet
        </h2>
        <p className="text-night-muted mb-6 text-sm leading-relaxed">
          Connect your Lace wallet to compute your privacy-preserving credit score.
          Your financial data never leaves your device.
        </p>

        <AnimatedButton
          variant="primary"
          onClick={connect}
          disabled={isLoading}
          fullWidth
          className="px-6 py-3 text-lg"
        >
          {isLoading ? (
            <span className="flex items-center justify-center gap-2">
              <Spinner />
              Connecting...
            </span>
          ) : (
            'Connect Lace Wallet'
          )}
        </AnimatedButton>

        {error && <ErrorMessage message={error} />}

        <p className="text-xs text-night-muted/60 mt-4">
          Don&apos;t have Lace?{' '}
          <a
            href="https://www.lace.io/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-night-accent hover:underline"
          >
            Install it here →
          </a>
        </p>
        <p className="text-xs text-night-muted/40 mt-2">
          Supports Midnight Preprod &amp; Preview networks
        </p>
      </div>
    </motion.div>
  );
}

function Spinner() {
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

function ErrorMessage({ message }: { message: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      className="mt-3 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm"
    >
      {message}
    </motion.div>
  );
}
