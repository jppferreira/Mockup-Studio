import { useCallback, useEffect, useState } from 'react';
import { markOnboardingComplete } from '../lib/onboarding';

type Slide = {
  id: string;
  title: string;
  body: string;
  image: string;
};

const SLIDES: Slide[] = [
  {
    id: 'create',
    title: 'Create stunning 3D mockups',
    body: 'Build polished scenes for apps, websites, and presentations in minutes.',
    image: './onboarding/create-mockups.png',
  },
  {
    id: 'import',
    title: 'Import from your workflow',
    body: 'Drag in screens, connect Figma, or add assets to build scenes faster.',
    image: './onboarding/import-workflow.png',
  },
  {
    id: 'style',
    title: 'Style every detail',
    body: 'Adjust lighting, shadows, materials, and camera angles with precision.',
    image: './onboarding/style-detail.png',
  },
  {
    id: 'export',
    title: 'Animate and export',
    body: 'Preview motion, create polished presentations, and export ready-to-share mockups.',
    image: './onboarding/animate-export.png',
  },
];

export default function OnboardingFlow({ onComplete }: { onComplete: () => void }) {
  const [index, setIndex] = useState(0);
  const [dir, setDir] = useState<1 | -1>(1);
  const slide = SLIDES[index];
  const last = index >= SLIDES.length - 1;

  const finish = useCallback(() => {
    markOnboardingComplete();
    onComplete();
  }, [onComplete]);

  const goNext = useCallback(() => {
    if (last) {
      finish();
      return;
    }
    setDir(1);
    setIndex((value) => Math.min(SLIDES.length - 1, value + 1));
  }, [finish, last]);

  const goTo = (next: number) => {
    if (next === index || next < 0 || next >= SLIDES.length) return;
    setDir(next > index ? 1 : -1);
    setIndex(next);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight' || event.key === 'Enter') {
        event.preventDefault();
        goNext();
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        if (index > 0) {
          setDir(-1);
          setIndex((value) => value - 1);
        }
      } else if (event.key === 'Escape') {
        event.preventDefault();
        finish();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [finish, goNext, index]);

  return (
    <div className="onboard" role="dialog" aria-modal="true" aria-labelledby="onboard-title">
      <div className="onboard-frame">
        <header className="onboard-copy">
          <div
            key={slide.id}
            className={`onboard-copy-swap ${dir > 0 ? 'from-right' : 'from-left'}`}
          >
            <h1 id="onboard-title">{slide.title}</h1>
            <p>{slide.body}</p>
          </div>
        </header>

        <div
          key={`visual-${slide.id}`}
          className={`onboard-stage ${dir > 0 ? 'from-right' : 'from-left'}`}
        >
          <div className="onboard-visual">
            <img src={slide.image} alt="" draggable={false} />
          </div>
        </div>

        <footer className="onboard-nav">
          <button type="button" className="onboard-skip" onClick={finish}>
            Skip
          </button>

          <div className="onboard-dots" role="tablist" aria-label="Onboarding steps">
            {SLIDES.map((item, dotIndex) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={dotIndex === index}
                aria-label={`Step ${dotIndex + 1}: ${item.title}`}
                className={dotIndex === index ? 'is-active' : undefined}
                onClick={() => goTo(dotIndex)}
              />
            ))}
          </div>

          <button
            type="button"
            className={`onboard-next${last ? ' is-start' : ''}`}
            onClick={goNext}
          >
            {last ? 'Get started' : 'Next →'}
          </button>
        </footer>
      </div>
    </div>
  );
}
