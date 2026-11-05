import {
  useEffect,
  useRef,
  useState,
  type ElementType,
  type ReactNode,
  type RefObject,
} from 'react';

function useReveal<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const show = () => setVisible(true);

    // Tall blocks (e.g. credits tables) often never hit a high threshold when only
    // their top edge is on screen — keep threshold at 0 so any peek reveals them.
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          show();
          io.disconnect();
        }
      },
      { threshold: 0, rootMargin: '0px 0px -8px 0px' },
    );
    io.observe(node);

    // Cover the first paint before the observer callback runs.
    const rect = node.getBoundingClientRect();
    if (rect.top < window.innerHeight && rect.bottom > 0) {
      show();
      io.disconnect();
    }

    // Safety net: never leave content permanently invisible.
    const fallback = window.setTimeout(show, 1200);

    return () => {
      io.disconnect();
      window.clearTimeout(fallback);
    };
  }, []);

  return { ref, visible };
}

export function Reveal({
  children,
  className = '',
  as: Tag = 'div',
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  as?: ElementType;
  delay?: number;
}) {
  const { ref, visible } = useReveal<HTMLElement>();
  return (
    <Tag
      ref={ref as RefObject<never>}
      className={`reveal ${visible ? 'is-visible' : ''} ${className}`.trim()}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </Tag>
  );
}
