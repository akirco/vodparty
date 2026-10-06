import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

/**
 * Behavioural tests for the sanitizer, run against a real DOM.
 *
 * Assertions are on *output*, never on the implementation, so swapping the
 * engine does not invalidate them. Each payload is a technique a naive
 * tag-and-attribute stripper misses.
 */

let sanitizeHtml: (html: string) => string;
let stripHtml: (html?: string | null) => string;
let loaded = false;

/**
 * DOMPurify captures `window` at import time, so the jsdom globals must be in
 * place before the module graph is loaded. Hence a lazy one-shot import rather
 * than a top-level `import`.
 */
const load = async () => {
  if (loaded) return;
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  const w = dom.window as unknown as Record<string, unknown>;
  const g = globalThis as Record<string, unknown>;
  g.window = dom.window;
  g.document = dom.window.document;
  g.Node = dom.window.Node;
  g.Element = dom.window.Element;
  g.DocumentFragment = dom.window.DocumentFragment;
  g.trustedTypes = undefined;
  void w;

  ({ sanitizeHtml } = await import('../src/utils/sanitizeHtml.ts'));
  ({ stripHtml } = await import('../src/utils/stripHtml.ts'));
  loaded = true;
};

before(load);

describe('sanitizeHtml: keeps legitimate content', () => {
  it('preserves paragraphs and emphasis', () => {
    const out = sanitizeHtml('<p>A <b>great</b> film.</p>');
    assert.match(out, /<p>/);
    assert.match(out, /<b>great<\/b>/);
    assert.match(out, /film\./);
  });

  it('preserves links with safe schemes', () => {
    assert.match(
      sanitizeHtml('<a href="https://x.com">x</a>'),
      /href="https:\/\/x\.com"/,
    );
    assert.match(sanitizeHtml('<a href="/local">x</a>'), /href="\/local"/);
  });

  it('preserves images with https sources', () => {
    assert.match(
      sanitizeHtml('<img src="https://cdn/x.jpg">'),
      /src="https:\/\/cdn\/x\.jpg"/,
    );
  });

  it('returns empty for empty input', () => {
    assert.equal(sanitizeHtml(''), '');
  });

  it('strips target so links cannot open a new tab', () => {
    // With a restrictive ALLOWED_URI_REGEXP DOMPurify drops `target` anyway;
    // the allowlist omits it explicitly rather than relying on that.
    const out = sanitizeHtml('<a href="https://x.com" target="_blank">x</a>');
    assert.ok(!/target=/i.test(out), out);
    assert.match(out, /href="https:\/\/x\.com"/);
  });

  it('marks third-party poster images as lazy', () => {
    const out = sanitizeHtml('<img src="https://cdn/x.jpg">');
    assert.match(out, /loading="lazy"/);
  });
});

describe('sanitizeHtml: blocks script execution', () => {
  it('removes script tags and their contents', () => {
    const out = sanitizeHtml('<p>ok</p><script>alert(1)</script>');
    assert.ok(!/<script/i.test(out));
    assert.ok(!out.includes('alert'));
    assert.match(out, /ok/);
  });

  it('removes inline event handlers', () => {
    assert.ok(!/onclick/i.test(sanitizeHtml('<p onclick="alert(1)">x</p>')));
  });

  it('removes img onerror', () => {
    const out = sanitizeHtml('<img src="https://a/b.png" onerror="alert(1)">');
    assert.ok(!/onerror/i.test(out));
  });

  it('removes javascript: hrefs', () => {
    const out = sanitizeHtml('<a href="javascript:alert(1)">x</a>');
    assert.ok(!/javascript:/i.test(out));
  });

  it('removes javascript: with embedded control characters', () => {
    // The hand-rolled version needed a special case for this; DOMPurify's
    // parser handles it.
    const out = sanitizeHtml('<a href="java\tscript:alert(1)">x</a>');
    assert.ok(!/script\s*:/i.test(out.replace(/\s+/g, '')));
  });

  it('removes data:text/html hrefs', () => {
    const out = sanitizeHtml(
      '<a href="data:text/html;base64,PHNjcmlwdD4=">x</a>',
    );
    assert.ok(!/data:text\/html/i.test(out));
  });

  it('removes style tags', () => {
    const out = sanitizeHtml(
      '<style>body{background:url(javascript:alert(1))}</style><p>x</p>',
    );
    assert.ok(!/<style/i.test(out));
  });

  it('removes iframe, object and embed', () => {
    for (const tag of ['iframe', 'object', 'embed']) {
      const out = sanitizeHtml(`<${tag} src="https://evil"></${tag}><p>x</p>`);
      assert.ok(!out.includes(`<${tag}`), `${tag} survived`);
    }
  });

  it('removes form controls', () => {
    const out = sanitizeHtml(
      '<form action="https://evil"><input name="a"><button>go</button></form>',
    );
    assert.ok(!/<form/i.test(out));
    assert.ok(!/<input/i.test(out));
  });

  it('removes noscript and template containers', () => {
    for (const tag of ['noscript', 'template']) {
      const out = sanitizeHtml(`<${tag}><p>x</p></${tag}>`);
      assert.ok(!out.includes(`<${tag}`), `${tag} survived`);
    }
  });
});

describe('sanitizeHtml: blocks parser-differential vectors', () => {
  it('neutralises svg script payloads', () => {
    const out = sanitizeHtml('<svg><script>alert(1)</script></svg>');
    assert.ok(!/<script/i.test(out));
    assert.ok(!/alert\(1\)/.test(out));
  });

  it('does not keep svg onload', () => {
    assert.ok(!/onload/i.test(sanitizeHtml('<svg onload="alert(1)"></svg>')));
  });

  it('handles math/mglyph namespace confusion', () => {
    const out = sanitizeHtml(
      '<math><mtext><mglyph><style><img src=x onerror=alert(1)>',
    );
    assert.ok(!/onerror/i.test(out));
  });

  it('strips srcset', () => {
    const out = sanitizeHtml(
      '<img src="https://a/b.png" srcset="javascript:alert(1)">',
    );
    assert.ok(!/srcset/i.test(out));
  });

  it('strips style attributes', () => {
    const out = sanitizeHtml(
      '<p style="background:url(javascript:alert(1))">x</p>',
    );
    assert.ok(!/style=/i.test(out));
  });
});

describe('sanitizeHtml: known payload corpus', () => {
  const payloads = [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '<svg/onload=alert(1)>',
    '<iframe src="javascript:alert(1)"></iframe>',
    '<a href="javascript:alert(1)">x</a>',
    '<div style="width:expression(alert(1))">x</div>',
    '<form><button formaction="javascript:alert(1)">x</button></form>',
    '<math><maction actiontype="statusline#javascript:alert(1)">x</maction></math>',
    '<xss id=x tabindex=1 onactivate=alert(1)></xss>',
    '<noscript><p title="</noscript><img src=x onerror=alert(1)>">',
    '<table background="javascript:alert(1)"><tr><td>x</td></tr></table>',
    '<object data="javascript:alert(1)"></object>',
    '<embed src="javascript:alert(1)">',
    '<meta http-equiv="refresh" content="0;url=javascript:alert(1)">',
  ];

  for (const payload of payloads) {
    it(`neutralises: ${payload.slice(0, 46)}`, () => {
      const out = sanitizeHtml(payload);
      assert.ok(
        !/<script|onerror|onload|onactivate|javascript:/i.test(out),
        `dangerous content survived: ${out}`,
      );
    });
  }

  it('renders entity-encoded markup as inert text, not elements', () => {
    // `&lt;img onerror=...&gt;` surviving as text is correct: it is escaped, so
    // it cannot become an element. Asserted via the DOM rather than the string,
    // because the escaped form still *contains* the substring "onerror".
    load();
    const host = document.createElement('div');
    host.innerHTML = sanitizeHtml(
      '<listing>&lt;img src=x onerror=alert(1)&gt;</listing>',
    );
    assert.equal(host.querySelectorAll('img').length, 0);
    assert.equal(host.querySelectorAll('listing').length, 0);
    assert.match(host.textContent ?? '', /onerror/); // present, but as text
  });

  it('assigning sanitized output to innerHTML executes nothing', () => {
    const host = document.createElement('div');
    let executed = false;
    const w = globalThis as unknown as Record<string, unknown>;
    const originalAlert = w.alert;
    w.alert = () => {
      executed = true;
    };
    try {
      for (const payload of payloads) host.innerHTML = sanitizeHtml(payload);
    } finally {
      w.alert = originalAlert;
    }
    assert.equal(executed, false);
  });
});

describe('stripHtml: display only, and documented as such', () => {
  it('is documented as not a security boundary', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(
      new URL('../src/utils/stripHtml.ts', import.meta.url),
      'utf8',
    );
    assert.match(src, /NOT a security boundary/);
  });

  it('produces text with no tags at all', () => {
    assert.equal(stripHtml('<p>hello <b>there</b></p>'), 'hello there');
  });

  it('is never used for an innerHTML sink', async () => {
    const { readFileSync } = await import('node:fs');
    const { globSync } = await import('node:fs');
    void globSync;
    const files = [
      '../src/pages/Player.tsx',
      '../src/components/VideoCard.tsx',
      '../src/pages/History.tsx',
      '../src/pages/Home.tsx',
    ];
    for (const rel of files) {
      const src = readFileSync(new URL(rel, import.meta.url), 'utf8');
      if (!src.includes('dangerouslySetInnerHTML')) continue;
      assert.ok(
        !/__html:\s*stripHtml/.test(src),
        `${rel} feeds stripHtml into innerHTML`,
      );
    }
  });
});
