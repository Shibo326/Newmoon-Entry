import Lottie from 'lottie-react';

interface LottieAnimationProps {
  /** URL to a Lottie JSON file, or imported JSON data */
  animationData?: object;
  loop?: boolean;
  autoplay?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Reusable Lottie animation component.
 * Use `animationData` for local JSON imports from src/assets/lottie/.
 */
export function LottieAnimation({
  animationData,
  loop = true,
  autoplay = true,
  className,
  style,
}: LottieAnimationProps) {
  if (!animationData) {
    return null;
  }

  return (
    <Lottie
      animationData={animationData}
      loop={loop}
      autoPlay={autoplay}
      className={className}
      style={style}
    />
  );
}

export default LottieAnimation;
