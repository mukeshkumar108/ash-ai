'use client';

import { useState, useEffect } from 'react';

interface AnimatedTextProps {
  text: string;
  speed?: number;
  className?: string;
}

export const AnimatedText = ({
  text,
  speed = 50,
  className,
}: AnimatedTextProps) => {
  const [displayText, setDisplayText] = useState('');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isComplete, setIsComplete] = useState(false);

  useEffect(() => {
    if (currentIndex < text.length) {
      const timeout = setTimeout(() => {
        setDisplayText((prev) => prev + text[currentIndex]);
        setCurrentIndex((prev) => prev + 1);
      }, speed);

      return () => clearTimeout(timeout);
    } else {
      setIsComplete(true);
    }
  }, [currentIndex, text, speed]);

  useEffect(() => {
    // Reset when text changes
    setDisplayText('');
    setCurrentIndex(0);
    setIsComplete(false);
  }, [text]);

  return (
    <span className={className}>
      {displayText}
      {!isComplete && <span className="animate-pulse text-primary">|</span>}
    </span>
  );
};
