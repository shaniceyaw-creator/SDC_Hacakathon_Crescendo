import { useEffect, useState } from 'react';
import { BrandMark } from '@/components/brand-mark';
import '@/styles/manager.css';
import '@/styles/about.css';

const BASE = import.meta.env.BASE_URL;
const reduced = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export default function About() {
  const [intro, setIntro] = useState(() => !reduced());
  useEffect(() => {
    if (!intro) return;
    const t = window.setTimeout(() => setIntro(false), 2700);
    return () => window.clearTimeout(t);
  }, [intro]);

  return (
    <>
      {intro && (
        <div className="ab-intro" role="status" aria-label="OpusEvents" data-testid="about-intro">
          <BrandMark size={112} />
          <div className="ab-intro-word">Opus<i>Events</i></div>
          <button autoFocus type="button" className="ab-skip" onClick={() => setIntro(false)} data-testid="button-skip-intro">Skip</button>
        </div>
      )}
      <div className={`mg-page${intro ? '' : ' ab-page'}`} data-testid="page-about" aria-hidden={intro || undefined} style={intro ? { visibility: 'hidden' } : undefined}>
        <header className="ab-hero2">
          <BrandMark size={64} />
          <h1>Crescendo</h1>
          <p className="ab-sdc">SDC Hackathon</p>
          <div className="ab-lede">
            <p>In music, an opus is a masterpiece where every instrument plays in perfect harmony, and at <strong>Team Crescendo</strong>, we built <strong>OpusEvent</strong> to bring that same synchronized perfection to event management.</p>
            <p>Designed as an intelligent module for the <strong>Orbyte ecosystem</strong>, OpusEvent eliminates the chaos of the Malaysian festive rush by seamlessly aligning customer bookings, <strong>AI-driven inventory predictions</strong>, and <strong>live staff availability</strong> into one unified workflow.</p>
            <p>Whether you are a manager conducting the big picture, an event crew member executing tasks on the ground, or a customer booking an unforgettable experience, OpusEvent ensures every moving part of your business plays in perfect rhythm.</p>
          </div>
        </header>
        <section className="ab-powered" data-testid="section-powered-by">
          <span>Powered by</span>
          <div className="ab-logos">
            <a href="https://replit.com/" target="_blank" rel="noopener noreferrer" aria-label="Replit website (opens in a new tab)">
              <img src={`${BASE}powered-by/replit.webp`} alt="Replit" data-testid="logo-replit" />
            </a>
            <a href="https://www.runpod.io/" target="_blank" rel="noopener noreferrer" aria-label="RunPod website (opens in a new tab)">
              <img src={`${BASE}powered-by/runpod.webp`} alt="RunPod" data-testid="logo-runpod" />
            </a>
            <a href="https://www.orbyte.my/" target="_blank" rel="noopener noreferrer" aria-label="Orbyte website (opens in a new tab)">
              <img className="ab-orbyte" src={`${BASE}powered-by/orbyte.png`} alt="Orbyte" data-testid="logo-orbyte" />
            </a>
          </div>
        </section>
      </div>
    </>
  );
}
