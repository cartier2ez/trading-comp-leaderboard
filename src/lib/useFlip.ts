import { useLayoutEffect, useRef } from "react";

/**
 * FLIP animation for reordering: when the order of `keys` changes, each element
 * slides from its old spot to its new one. Returns a ref-callback factory.
 */
export function useFlip(keys: string[]): (key: string) => (el: HTMLElement | null) => void {
  const els = useRef(new Map<string, HTMLElement>());
  const last = useRef(new Map<string, { x: number; y: number }>());
  const order = keys.join("|");

  useLayoutEffect(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    els.current.forEach((el, key) => {
      const now = { x: el.offsetLeft, y: el.offsetTop };
      const before = last.current.get(key);
      if (before && !reduce && (before.x !== now.x || before.y !== now.y)) {
        el.animate(
          [{ transform: `translate(${before.x - now.x}px, ${before.y - now.y}px)` }, { transform: "none" }],
          { duration: 700, easing: "cubic-bezier(.2,.9,.25,1.15)" },
        );
      }
      last.current.set(key, now);
    });
  }, [order]);

  return (key) => (el) => {
    if (el) els.current.set(key, el);
    else els.current.delete(key);
  };
}
