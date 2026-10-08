import type { CSSProperties, ElementType } from 'react';

type RevealType = 'mask' | 'mask-fast' | 'soft';

interface SplitProps {
  /** Zeilen werden mit "\n" getrennt. */
  text: string;
  as?: ElementType;
  reveal?: RevealType;
  className?: string;
  delay?: number;
  id?: string;
}

/**
 * Überschrift in Wörter zerlegt – bereits beim Rendern, damit kein DOM nachträglich umgebaut wird.
 * Screenreader lesen den Originaltext (sr-only), die Fragmente sind aria-hidden.
 */
export function Split({ text, as: Tag = 'h2', reveal = 'mask', className, delay, id }: SplitProps) {
  let i = 0;
  const lines = text.split('\n');
  const style = delay ? ({ '--rv-delay': `${delay}ms` } as CSSProperties) : undefined;
  return (
    <Tag className={className} data-reveal={reveal} style={style} id={id}>
      <span className="sr-only">{lines.join(' ')}</span>
      <span aria-hidden="true">
        {lines.map((line, li) => (
          <span className="split__line" key={li}>
            {line.split(' ').map((word, wi, arr) => (
              <span key={wi}>
                <span className="split__w">
                  <span className="split__in" style={{ '--i': i++ } as CSSProperties}>
                    {word}
                  </span>
                </span>
                {wi < arr.length - 1 ? ' ' : null}
              </span>
            ))}
          </span>
        ))}
      </span>
    </Tag>
  );
}
