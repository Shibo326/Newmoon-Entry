import { type ReactNode, type ReactElement, Children } from 'react';
import { motion, useInView } from 'framer-motion';
import { useRef } from 'react';

interface FadeInSectionProps {
  children: ReactNode;
  delay?: number;
  direction?: 'up' | 'down' | 'left' | 'right';
  stagger?: boolean;
  staggerDelay?: number;
  className?: string;
}

export function FadeInSection({
  children,
  delay = 0,
  direction = 'up',
  stagger = false,
  staggerDelay = 0.08,
  className = '',
}: FadeInSectionProps) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: '-50px' });

  const directionOffset = {
    up: { y: 24, x: 0 },
    down: { y: -24, x: 0 },
    left: { x: 24, y: 0 },
    right: { x: -24, y: 0 },
  };

  const offset = directionOffset[direction];

  if (stagger) {
    const items = Children.toArray(children) as ReactElement[];
    return (
      <div ref={ref} className={className}>
        {items.map((child, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, ...offset }}
            animate={isInView ? { opacity: 1, x: 0, y: 0 } : { opacity: 0, ...offset }}
            transition={{
              duration: 0.5,
              delay: delay + i * staggerDelay,
              ease: [0.25, 0.46, 0.45, 0.94],
            }}
          >
            {child}
          </motion.div>
        ))}
      </div>
    );
  }

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, ...offset }}
      animate={isInView ? { opacity: 1, x: 0, y: 0 } : { opacity: 0, ...offset }}
      transition={{
        duration: 0.5,
        delay,
        ease: [0.25, 0.46, 0.45, 0.94],
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
