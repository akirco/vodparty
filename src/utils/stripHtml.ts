/**
 * Flatten CMS-HTML to plain text, for places that only need the prose
 * (card overlays, list subtitles).
 *
 * This is deliberately NOT a security boundary. It removes tags for display
 * only. Anything rendered as HTML must go through `sanitizeHtml`.
 */
export function stripHtml(html?: string | null): string {
  if (!html) return '';
  return (
    html
      // Drop script/style bodies, otherwise their source ends up on screen.
      .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<\/(p|div|li|h[1-6])>/gi, ' ')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/\s+/g, ' ')
      .trim()
  );
}
