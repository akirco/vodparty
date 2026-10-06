import { useCallback, useEffect, useRef } from 'react';

/**
 * Debounce a callback by `delay` ms.
 *
 * Returns a stable function identity, and the pending call is cancelled on
 * unmount so a debounced save cannot fire after the component is gone.
 */
export const useDebouncedCallback = <Args extends unknown[]>(
  callback: (...args: Args) => void,
  delay: number,
): ((...args: Args) => void) => {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return useCallback(
    (...args: Args) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        callbackRef.current(...args);
      }, delay);
    },
    [delay],
  );
};
