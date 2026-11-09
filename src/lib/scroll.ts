// Scroll position per history entry, so Back and Forward land where the page was left instead of at the top.
// Pages call `startScroll()` once their content is on screen; a push starts at the top, a pop restores.

const saved = new Map<string, number>();
// the entry Back/Forward arrived at and its offset, read before the new page can move the scroll
let popped: { key: string; y: number | undefined } | null = null;

const here = () => location.pathname + location.search;

if (typeof window !== 'undefined') {
  history.scrollRestoration = 'manual';
  // recorded under the address current at the event, so a scroll right before a navigation keeps its own entry
  window.addEventListener('scroll', () => saved.set(here(), window.scrollY), { passive: true });
  window.addEventListener('popstate', () => {
    const key = here();
    popped = { key, y: saved.get(key) };
  });
  // wouter patches pushState to dispatch this event; a new entry never restores
  window.addEventListener('pushState', () => {
    popped = null;
  });
}

/** Top for a new entry; the remembered offset after Back/Forward, retried for a few frames while the page grows. */
export function startScroll(): void {
  const key = here();
  // kept until the next navigation, so a repeated call (StrictMode runs effects twice) restores the same offset
  const target = popped?.key === key ? popped.y : undefined;
  if (!target) {
    window.scrollTo(0, 0);
    return;
  }
  let tries = 0;
  const step = () => {
    window.scrollTo(0, target);
    if (Math.abs(window.scrollY - target) > 1 && ++tries < 30 && here() === key) requestAnimationFrame(step);
  };
  step();
}
