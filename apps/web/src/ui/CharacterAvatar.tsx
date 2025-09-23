import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CHARACTER_VISUALS, CharacterType, CharacterExpression, EXPRESSION_SEQUENCES, expressionCycler } from '../lib/characterVisuals';

interface CharacterAvatarProps {
  character: CharacterType;
  expression?: CharacterExpression;
  autoAnimate?: boolean;
  size?: 'small' | 'medium' | 'large';
  showAsciiArt?: boolean;
  onExpressionChange?: (expression: CharacterExpression) => void;
}

export default function CharacterAvatar({
  character,
  expression = 'neutral',
  autoAnimate = true,
  size = 'medium',
  showAsciiArt = true,
  onExpressionChange,
}: CharacterAvatarProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [currentExpression, setCurrentExpression] = useState<CharacterExpression>(expression);
  const [isAnimating, setIsAnimating] = useState(false);
  const animationFrameRef = useRef<number>();
  const expressionGeneratorRef = useRef<Generator<CharacterExpression>>();

  const visual = CHARACTER_VISUALS[character];
  const currentVisualExpression = visual.expressions[currentExpression];

  const sizeMap = {
    small: { width: 150, height: 150, fontSize: 48 },
    medium: { width: 250, height: 250, fontSize: 72 },
    large: { width: 350, height: 350, fontSize: 96 },
  };

  const dimensions = sizeMap[size];

  // Initialize expression cycler
  useEffect(() => {
    if (autoAnimate) {
      const sequence = EXPRESSION_SEQUENCES.idle;
      expressionGeneratorRef.current = expressionCycler(sequence);
    }
  }, [autoAnimate]);

  // Auto-animate expressions
  useEffect(() => {
    if (autoAnimate && expressionGeneratorRef.current) {
      const interval = setInterval(() => {
        const nextExpression = expressionGeneratorRef.current?.next().value;
        if (nextExpression) {
          setCurrentExpression(nextExpression);
          onExpressionChange?.(nextExpression);
        }
      }, 3000 + Math.random() * 2000); // Random interval between 3-5 seconds

      return () => clearInterval(interval);
    }
  }, [autoAnimate, onExpressionChange]);

  // Update expression when prop changes
  useEffect(() => {
    if (!autoAnimate && expression !== currentExpression) {
      setCurrentExpression(expression);
    }
  }, [expression, autoAnimate, currentExpression]);

  // Canvas animation
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let particles: Array<{
      x: number;
      y: number;
      vx: number;
      vy: number;
      life: number;
      emoji: string;
    }> = [];

    const animate = () => {
      ctx.clearRect(0, 0, dimensions.width, dimensions.height);

      // Draw gradient background
      const gradient = ctx.createLinearGradient(0, 0, dimensions.width, dimensions.height);
      const colors = visual.gradient.match(/#[a-f0-9]{6}/gi) || ['#667eea', '#764ba2'];
      gradient.addColorStop(0, colors[0] + '20');
      gradient.addColorStop(1, colors[1] + '20');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, dimensions.width, dimensions.height);

      // Draw character emoji
      ctx.font = `${dimensions.fontSize}px Arial`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(
        currentVisualExpression.emoji,
        dimensions.width / 2,
        dimensions.height / 2
      );

      // Animate particles for certain expressions
      if (['excited', 'celebrating', 'shocked'].includes(currentExpression)) {
        // Add new particles
        if (Math.random() > 0.7) {
          const particleEmojis = {
            excited: ['✨', '⭐', '💫'],
            celebrating: ['🎉', '🎊', '✨', '🎈'],
            shocked: ['❗', '⚡', '💥'],
          };

          const emojis = particleEmojis[currentExpression as keyof typeof particleEmojis] || ['✨'];

          particles.push({
            x: dimensions.width / 2 + (Math.random() - 0.5) * 100,
            y: dimensions.height / 2,
            vx: (Math.random() - 0.5) * 2,
            vy: -Math.random() * 3 - 1,
            life: 1,
            emoji: emojis[Math.floor(Math.random() * emojis.length)],
          });
        }

        // Update and draw particles
        particles = particles.filter(p => p.life > 0);
        particles.forEach(p => {
          p.x += p.vx;
          p.y += p.vy;
          p.vy += 0.1; // Gravity
          p.life -= 0.02;

          ctx.globalAlpha = p.life;
          ctx.font = '20px Arial';
          ctx.fillText(p.emoji, p.x, p.y);
        });

        ctx.globalAlpha = 1;
      }

      // Add pulsing effect for thinking
      if (currentExpression === 'thinking') {
        const pulse = Math.sin(Date.now() / 500) * 0.1 + 0.9;
        ctx.globalAlpha = pulse;
        ctx.font = '30px Arial';
        ctx.fillText('💭', dimensions.width / 2 + 60, dimensions.height / 2 - 60);
        ctx.globalAlpha = 1;
      }

      animationFrameRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [currentExpression, dimensions, visual, currentVisualExpression]);

  return (
    <motion.div
      className="character-avatar"
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      style={{
        display: 'inline-block',
        position: 'relative',
      }}
    >
      {/* Canvas for animated character */}
      <canvas
        ref={canvasRef}
        width={dimensions.width}
        height={dimensions.height}
        style={{
          borderRadius: '20px',
          boxShadow: '0 10px 40px rgba(0,0,0,0.2)',
        }}
      />

      {/* ASCII Art Display */}
      {showAsciiArt && (
        <AnimatePresence mode="wait">
          <motion.div
            key={currentExpression}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.3 }}
            style={{
              position: 'absolute',
              bottom: '-60px',
              left: '50%',
              transform: 'translateX(-50%)',
              background: 'rgba(0,0,0,0.8)',
              color: '#00ff00',
              fontFamily: 'monospace',
              fontSize: '10px',
              padding: '5px',
              borderRadius: '5px',
              whiteSpace: 'pre',
              lineHeight: '1.2',
            }}
          >
            {currentVisualExpression.asciiArt.join('\n')}
          </motion.div>
        </AnimatePresence>
      )}

      {/* Character name badge */}
      <motion.div
        style={{
          position: 'absolute',
          top: '-30px',
          left: '50%',
          transform: 'translateX(-50%)',
          background: visual.gradient,
          color: 'white',
          padding: '5px 15px',
          borderRadius: '20px',
          fontSize: '14px',
          fontWeight: 'bold',
          boxShadow: '0 4px 10px rgba(0,0,0,0.2)',
          whiteSpace: 'nowrap',
        }}
      >
        {visual.name}
      </motion.div>

      {/* Expression indicator */}
      <motion.div
        key={currentExpression}
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        style={{
          position: 'absolute',
          bottom: '10px',
          right: '10px',
          background: 'white',
          borderRadius: '50%',
          width: '40px',
          height: '40px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '24px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
        }}
      >
        {currentVisualExpression.emoji}
      </motion.div>

      {/* Animated ring effect */}
      <motion.div
        animate={{
          scale: [1, 1.1, 1],
          opacity: [0.5, 0, 0.5],
        }}
        transition={{
          duration: 2,
          repeat: Infinity,
          ease: 'easeInOut',
        }}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          borderRadius: '20px',
          border: `3px solid ${visual.color}`,
          pointerEvents: 'none',
        }}
      />
    </motion.div>
  );
}