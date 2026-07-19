import { type ReactNode } from 'react';
import { motion } from 'framer-motion';

interface AnimatedCardProps {
  children: ReactNode;
  className?: string;
  delay?: number;
}

export function AnimatedCard({ children, className = '', delay = 0 }: AnimatedCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{
        duration: 0.4,
        delay,
        ease: [0.25, 0.46, 0.45, 0.94],
      }}
      whileHover={{
        y: -2,
        borderColor: 'rgba(139, 92, 246, 0.35)',
        boxShadow: '0 8px 32px rgba(139, 92, 246, 0.12)',
        transition: { duration: 0.25, ease: 'easeOut' },
      }}
      className={`glass rounded-xl p-4 transition-colors ${className}`}
    >
      {children}
    </motion.div>
  );
}
