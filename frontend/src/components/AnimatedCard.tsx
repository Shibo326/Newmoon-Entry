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
      initial={{ opacity: 0, scale: 0.92, y: 20 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{
        duration: 0.5,
        delay,
        ease: [0.25, 0.46, 0.45, 0.94],
      }}
      whileHover={{
        y: -6,
        scale: 1.02,
        borderColor: 'rgba(139, 92, 246, 0.5)',
        boxShadow: '0 12px 40px rgba(139, 92, 246, 0.15), 0 0 20px rgba(139, 92, 246, 0.08)',
        transition: { duration: 0.3, ease: 'easeOut' },
      }}
      className={`glass rounded-2xl p-5 cursor-default transition-colors ${className}`}
    >
      {children}
    </motion.div>
  );
}
