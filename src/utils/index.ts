import { useCallback, useRef } from 'react';

export const isTauri = () => {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
};

export function useLatest<T>(value: T): { readonly current: T } {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

const DANGEROUS_TAGS = [
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'link',
  'meta',
];

export function sanitizeHtml(html: string): string {
  const doc = document.createElement('div');
  doc.innerHTML = html;

  for (const tag of DANGEROUS_TAGS) {
    doc.querySelectorAll(tag).forEach((el) => el.remove());
  }

  doc.querySelectorAll('*').forEach((el) => {
    for (let i = el.attributes.length - 1; i >= 0; i--) {
      const attr = el.attributes[i];
      if (attr.name.toLowerCase().startsWith('on')) {
        el.removeAttribute(attr.name);
      } else if (
        attr.name.toLowerCase() === 'href' &&
        attr.value.toLowerCase().startsWith('javascript:')
      ) {
        el.removeAttribute(attr.name);
      }
    }
  });

  return doc.innerHTML;
}

export function useSpotlight<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const handleMouseMove = useCallback((e: React.MouseEvent<T>) => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    ref.current.style.setProperty('--mouse-x', `${e.clientX - rect.left}px`);
    ref.current.style.setProperty('--mouse-y', `${e.clientY - rect.top}px`);
  }, []);
  return { ref, handleMouseMove };
}

export function appendUrlParam(baseUrl: string, param: string): string {
  return baseUrl.includes('?') ? `${baseUrl}&${param}` : `${baseUrl}?${param}`;
}
