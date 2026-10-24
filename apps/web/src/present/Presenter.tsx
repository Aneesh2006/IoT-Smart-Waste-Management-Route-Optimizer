import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useEffect } from 'react';
import { useApp } from '../state/store.ts';
import { SCENES, goScene, stopPresentation } from './scenes.ts';

/** Keynote-style caption and controls while presenting. Clickers send PageDown/PageUp. */
export function Presenter() {
  const at = useApp((s) => s.present);

  useEffect(() => {
    if (at === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (['ArrowRight', 'PageDown', ' ', 'Enter'].includes(e.key)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        goScene(1);
      } else if (['ArrowLeft', 'PageUp', 'Backspace'].includes(e.key)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        goScene(-1);
      } else if (e.key === 'Escape') {
        e.stopImmediatePropagation();
        stopPresentation();
      }
    };
    // Capture phase, so presenting keys win over the app's own shortcuts.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [at]);

  if (at === null) return null;
  const scene = SCENES[at];
  const big = at === 0 || at === SCENES.length - 1;

  return (
    <>
      <div className={`pointer-events-none fixed inset-x-0 z-[55] flex justify-center px-6 ${big ? 'top-[30%]' : 'bottom-24'}`}>
        <div key={at} className="animate-[fadeUp_600ms_ease-out] text-center">
          <div className="eyebrow !text-[12px] !text-neon">{scene.kicker}</div>
          <h1
            className={`mt-1 font-bold tracking-tight text-white drop-shadow-[0_4px_30px_rgba(0,0,0,0.8)] ${big ? 'text-7xl md:text-8xl' : 'text-4xl md:text-5xl'}`}
          >
            {scene.title === 'BinSight' ? (
              <>
                Bin<span className="text-neon">Sight</span>
              </>
            ) : (
              scene.title
            )}
          </h1>
          <p className={`mx-auto mt-2 max-w-3xl text-slate-200 drop-shadow-[0_2px_12px_rgba(0,0,0,0.9)] ${big ? 'text-2xl' : 'text-lg'}`}>{scene.subtitle}</p>
        </div>
      </div>
      <div className="glass fixed left-1/2 top-[74px] z-[56] flex -translate-x-1/2 items-center gap-2 rounded-full px-2 py-1">
        <button onClick={() => goScene(-1)} className="grid size-7 place-items-center rounded-full hover:bg-white/10" title="Previous (←, PageUp)">
          <ChevronLeft size={15} />
        </button>
        <div className="flex gap-1">
          {SCENES.map((_, i) => (
            <span key={i} className={`h-1.5 rounded-full transition-all ${i === at ? 'w-5 bg-neon' : 'w-1.5 bg-white/25'}`} />
          ))}
        </div>
        <button onClick={() => goScene(1)} className="grid size-7 place-items-center rounded-full hover:bg-white/10" title="Next (→, PageDown, Space)">
          <ChevronRight size={15} />
        </button>
        <button onClick={stopPresentation} className="grid size-7 place-items-center rounded-full hover:bg-white/10" title="End (Esc)">
          <X size={14} />
        </button>
      </div>
    </>
  );
}
