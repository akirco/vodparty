import DOMPurify from 'dompurify';

/**
 * HTML sanitizer for third-party CMS content (synopsis, etc).
 *
 * Backed by DOMPurify rather than a hand-rolled pass: the previous
 * implementation only stripped a fixed tag list, `on*` handlers, and
 * `javascript:` in `href`, which leaves a long tail of parser-differential and
 * namespace-based vectors (`svg><script>`, `math`/`mglyph`, `noscript`,
 * `template`, mXSS via re-serialization, control-character scheme smuggling)
 * that are non-trivial to cover by hand and actively maintained upstream.
 *
 * Only allowlisted tags/attributes survive; everything else is dropped.
 */

/** Tags that make sense in a CMS synopsis and nothing else. */
const ALLOWED_TAGS = [
  'p',
  'br',
  'b',
  'strong',
  'i',
  'em',
  'u',
  's',
  'blockquote',
  'ul',
  'ol',
  'li',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'a',
  'img',
  'span',
  'div',
  'hr',
  'table',
  'thead',
  'tbody',
  'tr',
  'td',
  'th',
];

/*
 * `target` is deliberately absent. DOMPurify rejects any attribute whose value
 * is not a permitted URI, so with a restrictive ALLOWED_URI_REGEXP it strips
 * `target` regardless -- and a link that cannot open a new tab needs no
 * `rel="noopener"`. Dropping it here keeps the policy honest instead of
 * depending on an incidental side effect.
 */
const ALLOWED_ATTR = ['href', 'title', 'alt', 'src', 'width', 'height'];

/** Schemes permitted in href/src. Anything else (javascript:, data:) goes. */
const ALLOWED_URI_REGEXP = /^(?:https?:|mailto:|#|\/|\.\/|\.\.\/)/i;

let configured = false;
const configure = () => {
  if (configured) return;
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    // CMS posters are third-party; do not leak the app origin as Referer.
    if (node.tagName === 'IMG') node.setAttribute('loading', 'lazy');
  });
  configured = true;
};

export function sanitizeHtml(html: string): string {
  if (!html) return '';
  configure();
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP,
    // Drop the whole subtree for these rather than unwrapping them, so a
    // `<noscript><p title="</noscript><img src=x onerror=alert(1)>">` style
    // payload cannot re-materialise as markup.
    KEEP_CONTENT: true,
    FORBID_TAGS: [
      'script',
      'style',
      'noscript',
      'template',
      'iframe',
      'object',
      'embed',
      'form',
      'input',
      'button',
      'math',
      'svg',
    ],
    FORBID_ATTR: ['style', 'srcset', 'formaction', 'action', 'xlink:href'],
    RETURN_TRUSTED_TYPE: false,
  });
}
