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
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          io.disconnect();
        }
      },
      { threshold: 0.16, rootMargin: '0px 0px -6% 0px' },
    );
    io.observe(node);
    return () => io.disconnect();
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
