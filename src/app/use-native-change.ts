import { useEffect, useRef } from 'react';

/**
 * React's onChange fires on every keystroke. The DOM `change` event fires when an edit is
 * committed (picker closed, Enter, blur, stepper click), which is when we redraw.
 */
export function useNativeChange<T extends HTMLInputElement>(onCommit: (el: T) => void) {
  const ref = useRef<T>(null);
  const handler = useRef(onCommit);
  handler.current = onCommit;
  useEffect(() => {
    const el = ref.current!;
    const listener = () => handler.current(el);
    el.addEventListener('change', listener);
    return () => el.removeEventListener('change', listener);
  }, []);
  return ref;
}
