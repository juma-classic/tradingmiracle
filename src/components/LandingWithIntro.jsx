import React, { useEffect, useState } from 'react';
import MatrixRainCanvas from './MatrixRainCanvas';

const flickerKeyframes = `
@keyframes flicker {
  0%, 100% { opacity: 1; }
  10% { opacity: 0.8; }
  20% { opacity: 0.6; }
  30% { opacity: 0.9; }
  40% { opacity: 0.7; }
  50% { opacity: 1; }
  60% { opacity: 0.85; }
  70% { opacity: 0.95; }
  80% { opacity: 0.7; }
  90% { opacity: 0.9; }
}`;

const IntroLoader = ({ onFinish }) => {
    const [dots, setDots] = useState('');
    useEffect(() => {
        const style = document.createElement('style');
        style.innerHTML = flickerKeyframes;
        document.head.appendChild(style);
        let dotCount = 0;
        const dotInterval = setInterval(() => {
            dotCount = (dotCount + 1) % 4;
            setDots('.'.repeat(dotCount));
        }, 500);
        const finishTimeout = setTimeout(() => {
            clearInterval(dotInterval);
            onFinish();
        }, 3000);
        return () => {
            clearInterval(dotInterval);
            clearTimeout(finishTimeout);
            document.head.removeChild(style);
        };
    }, [onFinish]);
    return (
        <div
            style={{
                position: 'fixed',
                top: 0,
                left: 0,
                width: '100vw',
                height: '100vh',
                background: '#001f3f',
                color: '#39ff14',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontFamily: 'monospace',
                fontSize: '2.5rem',
                zIndex: 9999,
                flexDirection: 'column',
                overflow: 'hidden',
            }}
        >
            <MatrixRainCanvas />
            <span
                style={{
                    animation: 'flicker 1.5s infinite',
                    letterSpacing: '2px',
                    textShadow: '0 0 8px #39ff14, 0 0 2px #39ff14',
                    zIndex: 2,
                }}
            >
                Initializing{dots}
            </span>
        </div>
    );
};

export default function LandingWithIntro({ onFinish }) {
    const [showLoader, setShowLoader] = useState(true);
    useEffect(() => {
        if (!showLoader) {
            onFinish();
        }
    }, [showLoader, onFinish]);
    return showLoader ? <IntroLoader onFinish={() => setShowLoader(false)} /> : null;
}
