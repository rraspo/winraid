import * as React from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

const AnimatedText = React.forwardRef(
    (
        {
            text,
            gradientColors = 'linear-gradient(90deg, #000 0%, #fff 50%, #000 100%)',
            restColor,
            gradientAnimationDuration = 3,
            once = false,
            className,
            ...props
        },
        ref
    ) => {
        const [done, setDone] = React.useState(false);

        if (done && once) {
            return (
                <span
                    ref={ref}
                    className={cn(className)}
                    style={{
                        background: gradientColors,
                        backgroundSize: '300% 100%',
                        backgroundPosition: '0% center',
                        WebkitBackgroundClip: 'text',
                        WebkitTextFillColor: 'transparent',
                        backgroundClip: 'text',
                    }}
                    {...props}
                >
                    {text}
                </span>
            );
        }

        return (
            <motion.span
                ref={ref}
                className={cn(className)}
                style={{
                    background: gradientColors,
                    backgroundSize: '300% 100%',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    backgroundClip: 'text',
                }}
                animate={{
                    backgroundPosition: ['0% center', '100% center', '0% center'],
                }}
                transition={{
                    duration: gradientAnimationDuration,
                    repeat: once ? 0 : Infinity,
                    ease: 'easeInOut',
                }}
                onAnimationComplete={() => {
                    if (once) setDone(true);
                }}
                {...props}
            >
                {text}
            </motion.span>
        );
    }
);

AnimatedText.displayName = 'AnimatedText';

export { AnimatedText };
