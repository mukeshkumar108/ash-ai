'use client';

import { motion, useReducedMotion } from 'framer-motion';

/**
 * Calm, slow, drifting radial glow in the rose accent. Pure CSS transforms
 * (no WebGL/canvas) so it stays cheap. Hidden entirely when the user prefers
 * reduced motion.
 */
export function AnimatedBackground() {
  const shouldReduceMotion = useReducedMotion();

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
    >
      <motion.div
        className="absolute left-1/2 top-1/2 h-[160vmax] w-[160vmax] -translate-x-1/2 -translate-y-1/2 rounded-full blur-[120px]"
        style={{
          background:
            'radial-gradient(circle at 30% 35%, rgba(215,102,150,0.16), transparent 55%)',
        }}
        animate={
          shouldReduceMotion
            ? undefined
            : { x: ['-55%', '-45%', '-55%'], y: ['-55%', '-45%', '-55%'] }
        }
        transition={{
          duration: 26,
          repeat: Number.POSITIVE_INFINITY,
          ease: 'easeInOut',
        }}
      />
      <motion.div
        className="absolute left-1/2 top-1/2 h-[120vmax] w-[120vmax] -translate-x-1/2 -translate-y-1/2 rounded-full blur-[100px]"
        style={{
          background:
            'radial-gradient(circle at 70% 65%, rgba(215,102,150,0.10), transparent 55%)',
        }}
        animate={
          shouldReduceMotion
            ? undefined
            : { x: ['-50%', '-60%', '-50%'], y: ['-50%', '-40%', '-50%'] }
        }
        transition={{
          duration: 34,
          repeat: Number.POSITIVE_INFINITY,
          ease: 'easeInOut',
        }}
      />
    </div>
  );
}
