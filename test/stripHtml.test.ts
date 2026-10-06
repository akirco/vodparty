import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { stripHtml } from '../src/utils/stripHtml.ts';

describe('stripHtml', () => {
  it('returns an empty string for empty input', () => {
    assert.equal(stripHtml(''), '');
    assert.equal(stripHtml(undefined), '');
    assert.equal(stripHtml(null), '');
  });

  it('removes tags but keeps prose', () => {
    assert.equal(
      stripHtml('<p>A thrilling <b>revenge</b> story.</p>'),
      'A thrilling revenge story.',
    );
  });

  it('does not leak script source into the overlay', () => {
    // The old inline regex in VideoCard left the body of <script> on screen.
    const out = stripHtml('<p>Hi</p><script>alert("xss")</script>');
    assert.ok(!out.includes('alert'));
    assert.ok(!out.includes('script'));
    assert.equal(out, 'Hi');
  });

  it('does not leak style source', () => {
    const out = stripHtml('<style>.a{color:red}</style><p>Body</p>');
    assert.ok(!out.includes('color:red'));
    assert.equal(out, 'Body');
  });

  it('collapses whitespace and newlines', () => {
    assert.equal(stripHtml('<p>a</p>\n\n  <p>b</p>'), 'a b');
  });

  it('turns block boundaries into spaces', () => {
    // Without this, `<p>a</p><p>b</p>` would render as "ab".
    assert.equal(stripHtml('<p>a</p><p>b</p>'), 'a b');
    assert.equal(stripHtml('a<br>b'), 'a b');
  });

  it('decodes the common entities', () => {
    assert.equal(stripHtml('a&nbsp;b'), 'a b');
    assert.equal(stripHtml('&lt;script&gt;'), '<script>');
    assert.equal(stripHtml('AT&amp;T'), 'AT&T');
    assert.equal(stripHtml('&quot;x&quot; &amp; &#39;y&#39;'), `"x" & 'y'`);
  });

  it('trims the result', () => {
    assert.equal(stripHtml('  <p>  spaced  </p>  '), 'spaced');
  });

  it('leaves plain text untouched', () => {
    assert.equal(stripHtml('Just a sentence.'), 'Just a sentence.');
  });
});
