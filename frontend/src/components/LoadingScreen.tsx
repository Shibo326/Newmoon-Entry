import { motion, AnimatePresence } from 'framer-motion';
import { useState, useEffect } from 'react';
import { Moon } from 'lucide-react';

interface LoadingScreenProps {
  onComplete: () => void;
  duration?: number;
}

export function LoadingScreen({ onComplete, duration = 2800 }: LoadingScreenProps) {
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsVisible(false);
      setTimeout(onComplete, 600);
    }, duration);
    return () => clearTimeout(timer);
  }, [duration, onComplete]);

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-night-bg overflow-hidden"
          exit={{ opacity: 0 }}
          transition={{ duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] }}
        >
          {/* Animated flowing wire lines */}
          <svg
            className="absolute inset-0 w-full h-full"
            viewBox="0 0 1200 800"
            preserveAspectRatio="xMidYMid slice"
            aria-hidden="true"
          >
            <defs>
              <linearGradient id="wire-gradient-1" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="rgba(139, 92, 246, 0)" />
                <stop offset="30%" stopColor="rgba(139, 92, 246, 0.6)" />
                <stop offset="70%" stopColor="rgba(168, 85, 247, 0.4)" />
                <stop offset="100%" stopColor="rgba(139, 92, 246, 0)" />
              </linearGradient>
              <linearGradient id="wire-gradient-2" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="rgba(217, 170, 79, 0)" />
                <stop offset="40%" stopColor="rgba(217, 170, 79, 0.5)" />
                <stop offset="60%" stopColor="rgba(245, 206, 107, 0.3)" />
                <stop offset="100%" stopColor="rgba(217, 170, 79, 0)" />
              </linearGradient>
              <linearGradient id="wire-gradient-3" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="rgba(236, 72, 153, 0)" />
                <stop offset="50%" stopColor="rgba(236, 72, 153, 0.3)" />
                <stop offset="100%" stopColor="rgba(236, 72, 153, 0)" />
              </linearGradient>
            </defs>

            <motion.path
              d="M-100,400 C100,350 300,500 500,380 C700,260 900,450 1100,350 C1300,250 1400,400 1500,380"
              fill="none"
              stroke="url(#wire-gradient-1)"
              strokeWidth="2"
              strokeLinecap="round"
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 1 }}
              transition={{ duration: 2, ease: [0.25, 0.46, 0.45, 0.94], delay: 0.2 }}
            />
            <motion.path
              d="M-50,500 C150,420 350,600 550,480 C750,360 850,520 1050,440 C1250,360 1350,500 1500,460"
              fill="none"
              stroke="url(#wire-gradient-2)"
              strokeWidth="1.5"
              strokeLinecap="round"
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 1 }}
              transition={{ duration: 2.2, ease: [0.25, 0.46, 0.45, 0.94], delay: 0.4 }}
            />
            <motion.path
              d="M-100,300 C100,380 250,250 450,320 C650,390 800,280 1000,340 C1200,400 1350,300 1500,320"
              fill="none"
              stroke="url(#wire-gradient-3)"
              strokeWidth="1"
              strokeLinecap="round"
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 0.6 }}
              transition={{ duration: 2.4, ease: [0.25, 0.46, 0.45, 0.94], delay: 0.6 }}
            />
            <motion.path
              d="M-100,600 C200,550 350,680 550,580 C750,480 900,620 1100,560 C1300,500 1400,620 1500,580"
              fill="none"
              stroke="url(#wire-gradient-2)"
              strokeWidth="1"
              strokeLinecap="round"
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 0.4 }}
              transition={{ duration: 2.6, ease: [0.25, 0.46, 0.45, 0.94], delay: 0.3 }}
            />
            <motion.path
              d="M-100,200 C150,260 300,180 500,240 C700,300 850,200 1050,260 C1250,320 1350,220 1500,260"
              fill="none"
              stroke="url(#wire-gradient-1)"
              strokeWidth="0.8"
              strokeLinecap="round"
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 0.3 }}
              transition={{ duration: 2.8, ease: [0.25, 0.46, 0.45, 0.94], delay: 0.5 }}
            />
          </svg>

          {/* Center logo + text */}
          <motion.div
            className="relative z-10 flex flex-col items-center gap-6"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.8, delay: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }}
          >
            {/* Moon icon with glow */}
            <motion.div
              className="relative"
              animate={{ y: [0, -8, 0] }}
              transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
            >
              <div className="w-16 h-16 rounded-2xl bg-night-accent/10 border border-night-accent/30 flex items-center justify-center">
                <Moon className="w-8 h-8 text-night-accent" strokeWidth={1.5} />
              </div>
              <motion.div
                className="absolute -inset-2 rounded-2xl"
                animate={{
                  boxShadow: [
                    '0 0 20px rgba(139, 92, 246, 0.2)',
                    '0 0 40px rgba(139, 92, 246, 0.4)',
                    '0 0 20px rgba(139, 92, 246, 0.2)',
                  ],
                }}
                transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
              />
            </motion.div>

            {/* Brand name */}
            <motion.h1
              className="text-4xl sm:text-5xl font-bold bg-gradient-to-r from-night-accent via-purple-300 to-night-accent bg-clip-text text-transparent"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.6 }}
            >
              NightScore
            </motion.h1>

            {/* Tagline */}
            <motion.p
              className="text-night-muted text-sm tracking-wider uppercase"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.6, delay: 1.0 }}
            >
              Privacy-Preserving Credit Scoring
            </motion.p>

            {/* Loading indicator */}
            <motion.div
              className="mt-6 flex items-center gap-2"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 1.4 }}
            >
              <LoadingDots />
            </motion.div>
          </motion.div>

          {/* Bottom gradient fade */}
          <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-night-bg to-transparent" />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function LoadingDots() {
  return (
    <div className="flex items-center gap-1.5">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="w-2 h-2 rounded-full bg-night-accent"
          animate={{
            opacity: [0.3, 1, 0.3],
            scale: [0.8, 1.2, 0.8],
          }}
          transition={{
            duration: 1.2,
            repeat: Infinity,
            delay: i * 0.2,
            ease: 'easeInOut',
          }}
        />
      ))}
    </div>
  );
}
