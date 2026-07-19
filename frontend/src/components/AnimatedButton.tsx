import { type ReactNode, type MouseEvent, useState, useRef } from 'react';
import { motion } from 'framer-motion';

type ButtonVariant = 'primary' | 'secondary' | 'ghost';

interface AnimatedButtonProps {
  children: ReactNode;
  onClick?: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  className?: string;
  fullWidth?: boolean;
}

interface Ripple {
  id: number;
  x: number;
  y: number;
}

export function AnimatedButton({
  children,
  onClick,
  variant = 'primary',
  disabled = false,
  className = '',
  fullWidth = false,
}: AnimatedButtonProps) {
  const [ripples, setRipples] = useState<Ripple[]>([]);
  const nextId = useRef(0);

  const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
    if (disabled) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const id = nextId.current++;

    setRipples((prev) => [...prev, { id, x, y }]);
    setTimeout(() => {
      setRipples((prev) => prev.filter((r) => r.id !== id));
    }, 600);

    onClick?.();
  };

  const baseStyles =
    'relative overflow-hidden rounded-xl font-semibold transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-night-accent/50';

  const variantStyles: Record<ButtonVariant, string> = {
    primary:
      'bg-night-accent text-white shadow-glow hover:shadow-glow-lg',
    secondary:
      'bg-transparent border border-night-accent/40 text-night-accent hover:border-night-accent/70 hover:bg-night-accent/5',
    ghost:
      'bg-transparent text-night-muted hover:text-night-text hover:bg-white/5',
  };

  const disabledStyles = 'opacity-50 cursor-not-allowed';
  const widthStyles = fullWidth ? 'w-full' : '';

  return (
    <motion.button
      onClick={handleClick}
      disabled={disabled}
      whileHover={disabled ? undefined : { scale: 1.02 }}
      whileTap={disabled ? undefined : { scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      className={`${baseStyles} ${variantStyles[variant]} ${disabled ? disabledStyles : ''} ${widthStyles} ${className}`}
    >
      {/* Glow pulse for primary */}
      {variant === 'primary' && !disabled && (
        <motion.span
          className="absolute inset-0 rounded-xl"
          animate={{
            boxShadow: [
              '0 0 20px rgba(139, 92, 246, 0.2)',
              '0 0 35px rgba(139, 92, 246, 0.4)',
              '0 0 20px rgba(139, 92, 246, 0.2)',
            ],
          }}
          transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
        />
      )}

      {/* Ripple effects */}
      {ripples.map((ripple) => (
        <span
          key={ripple.id}
          className="absolute rounded-full bg-white/25 pointer-events-none animate-ripple"
          style={{
            left: ripple.x - 4,
            top: ripple.y - 4,
            width: 8,
            height: 8,
          }}
        />
      ))}

      {/* Button content */}
      <span className="relative z-10">{children}</span>
    </motion.button>
  );
}
