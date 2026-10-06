import assert from 'node:assert/strict';
import { afterEach, before, describe, it } from 'node:test';

/**
 * Proves the core claim of the mini player: the <video> element is NOT
 * destroyed when the player route unmounts -- the same DOM node is re-parented
 * into the mini bar.
 *
 * This is a DOM-identity test rather than a visual one, because element
 * identity is exactly the property that matters: a remount would produce a
 * different node object and hls.js would be torn down with it.
 *
 * Three bugs are guarded here, all found by actually running this:
 *   1. the shell was display:none whenever the page unmounted -> sound but no
 *      picture in the mini bar;
 *   2. the surface element appears only after loading finishes, so a
 *      mount-time effect never saw it and drew the mini bar over the full
 *      player;
 *   3. the shell was moved before the mini bar had rendered, so it stayed in
 *      the parking node.
 */

let React: typeof import('react');
let ReactDOMClient: typeof import('react-dom/client');
let act: (cb: () => void | Promise<void>) => Promise<void>;
let MemoryRouter: typeof import('react-router-dom').MemoryRouter;
let PlayerHost: typeof import('../src/components/PlayerHost.tsx').PlayerHost;
let usePlayerHost: typeof import('../src/components/PlayerHost.tsx').usePlayerHost;

let hostApi: ReturnType<typeof usePlayerHost> | null = null;
let roots: Array<{ unmount: () => void }> = [];

const SESSION = {
  videoId: 7,
  videoName: 'Some Movie',
  videoPic: '',
  sourceId: 'srcA',
  groupName: 'line1',
  playUrl: 'https://example.com/a.m3u8',
  episodeIndex: 0,
};

before(async () => {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  const g = globalThis as Record<string, unknown>;
  g.window = dom.window;
  g.document = dom.window.document;
  // `navigator` is a getter-only global on modern Node; assignment throws.
  Object.defineProperty(globalThis, 'navigator', {
    value: dom.window.navigator,
    configurable: true,
    writable: true,
  });
  g.Node = dom.window.Node;
  g.Element = dom.window.Element;
  g.HTMLElement = dom.window.HTMLElement;
  g.DocumentFragment = dom.window.DocumentFragment;
  g.MutationObserver = dom.window.MutationObserver;
  g.KeyboardEvent = dom.window.KeyboardEvent;
  g.requestAnimationFrame = (cb: FrameRequestCallback) =>
    setTimeout(() => cb(0), 0) as unknown as number;
  g.cancelAnimationFrame = (id: number) => clearTimeout(id);
  g.trustedTypes = undefined;
  g.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
  g.IS_REACT_ACT_ENVIRONMENT = true;

  React = await import('react');
  ReactDOMClient = await import('react-dom/client');
  act = (React as unknown as { act: typeof act }).act;
  ({ MemoryRouter } = await import('react-router-dom'));
  const mod = await import('../src/components/PlayerHost.tsx');
  PlayerHost = mod.PlayerHost;
  usePlayerHost = mod.usePlayerHost;
});

afterEach(() => {
  // Unmounting must be clean. Re-parenting the shell used to break this with
  // "The node to be removed is not a child of this node".
  act(() => {
    for (const r of roots) r.unmount();
  });
  roots = [];
  document.body.innerHTML = '';
  hostApi = null;
});

/** Mount a tree and return its container; roots are cleaned up automatically. */
const mount = (ui: React.ReactElement) => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = ReactDOMClient.createRoot(host);
  act(() => {
    // The mini bar renders a <Link>, which needs router context.
    root.render(React.createElement(MemoryRouter, null, ui));
  });
  roots.push(root);
  return host;
};

/** Flush the lazy hls.js import and any resulting effects. */
const settle = async (ms = 60) => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
};

const shellOf = (): HTMLElement => {
  // Queried from the document, not the React root: once a surface claims it
  // the shell lives inside that surface, which is the whole mechanism.
  const shell = document.querySelector<HTMLElement>('[data-player-shell]');
  assert.ok(shell, 'player shell not found');
  return shell;
};

const miniOf = (): HTMLElement | null =>
  document.querySelector<HTMLElement>('[data-mini-surface]');

/** Stand-in for the /video/:id route: claims a surface on mount. */
const makePage = (claimed: { el: HTMLElement | null }) => {
  return function FakePlayerPage() {
    hostApi = usePlayerHost();
    React.useEffect(() => {
      const el = document.createElement('div');
      document.body.appendChild(el);
      claimed.el = el;
      // Mirrors Player.tsx's callback ref: fires again whenever the node
      // appears, which a mount-time effect would miss.
      hostApi?.attachSurface(el);
      return () => {
        hostApi?.attachSurface(null);
        el.remove();
        claimed.el = null;
      };
    }, []);
    return React.createElement('div', null, 'player page');
  };
};

describe('PlayerHost: playback survives navigation', () => {
  it('re-parents the same <video> instead of recreating it', async () => {
    const claimed = { el: null as HTMLElement | null };
    const FakePage = makePage(claimed);

    let setPage: ((v: boolean) => void) | null = null;
    const Harness: React.FC = () => {
      const [show, setShow] = React.useState(true);
      setPage = setShow;
      return React.createElement(
        PlayerHost,
        null,
        show ? React.createElement(FakePage) : null,
      );
    };

    mount(React.createElement(Harness));
    await settle();

    await act(async () => {
      hostApi?.setSource(SESSION.playUrl, 'https://img/p.jpg');
      hostApi?.setSession(SESSION);
    });

    const shell = shellOf();
    const video = shell.querySelector('video');
    assert.ok(video, 'no <video> inside the shell');
    assert.ok(
      claimed.el?.contains(shell),
      'shell should sit inside the player surface while the page is mounted',
    );
    assert.equal(miniOf(), null, 'no mini bar while on the player page');

    // Navigate away: unmount the page, keep the host alive.
    await act(async () => {
      setPage?.(false);
      await new Promise((r) => setTimeout(r, 40));
    });

    const shellAfter = shellOf();
    const videoAfter = shellAfter.querySelector('video');

    // THE assertion: same node object, not a replacement.
    assert.equal(shellAfter, shell, 'the player shell node was replaced');
    assert.equal(videoAfter, video, 'the <video> element was recreated');

    const mini = miniOf();
    assert.ok(mini, 'mini bar did not appear after navigating away');
    assert.ok(
      mini.contains(videoAfter as HTMLElement),
      'the same <video> should now be inside the mini bar',
    );
  });

  it('keeps the f shortcut working after navigating away', async () => {
    // Regression: the shortcut used to live in the player page, so it died the
    // moment the video kept playing on in the mini bar.
    const claimed = { el: null as HTMLElement | null };
    const FakePage = makePage(claimed);
    let setPage: ((v: boolean) => void) | null = null;
    const Harness: React.FC = () => {
      const [show, setShow] = React.useState(true);
      setPage = setShow;
      return React.createElement(
        PlayerHost,
        null,
        show ? React.createElement(FakePage) : null,
      );
    };

    mount(React.createElement(Harness));
    await settle();
    await act(async () => {
      hostApi?.setSource(SESSION.playUrl, '');
      hostApi?.setSession(SESSION);
      setPage?.(false);
      await new Promise((r) => setTimeout(r, 40));
    });

    // Now off the player page, with the mini bar showing.
    assert.ok(miniOf(), 'precondition: mini bar is showing');

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f' }));
    });

    const shell = shellOf();
    assert.equal(
      shell.style.position,
      'fixed',
      'pressing f off-page should still enter fullscreen',
    );
    assert.equal(shell.style.width, '100vw');
    assert.equal(document.body.style.overflow, 'hidden');

    // Escape leaves it.
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    assert.notEqual(
      shell.style.position,
      'fixed',
      'Escape should exit fullscreen',
    );
  });

  it('does not fullscreen into a hidden container (black screen)', async () => {
    // Regression: fullscreen moves the shell into the parking node, and that
    // node was `hidden` -- so the video was display:none inside a fullscreen
    // box, i.e. black.
    const claimed = { el: null as HTMLElement | null };
    const FakePage = makePage(claimed);
    let setPage: ((v: boolean) => void) | null = null;
    const Harness: React.FC = () => {
      const [show, setShow] = React.useState(true);
      setPage = setShow;
      return React.createElement(
        PlayerHost,
        null,
        show ? React.createElement(FakePage) : null,
      );
    };

    mount(React.createElement(Harness));
    await settle();
    await act(async () => {
      hostApi?.setSource(SESSION.playUrl, '');
      hostApi?.setSession(SESSION);
      setPage?.(false);
      await new Promise((r) => setTimeout(r, 40));
    });

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f' }));
    });

    const shell = shellOf();
    assert.equal(shell.style.position, 'fixed', 'precondition: fullscreen');

    // No ancestor may be display:none, or the fullscreen box renders black.
    let node: HTMLElement | null = shell;
    while (node) {
      assert.ok(
        !node.hasAttribute('hidden'),
        `fullscreen ancestor <${node.tagName.toLowerCase()}> is hidden -> black screen`,
      );
      node = node.parentElement;
    }

    assert.notEqual(
      getComputedStyle(shell).display,
      'none',
      'video is display:none while fullscreen',
    );
  });

  it('puts the video back in the player page after leaving fullscreen', async () => {
    // Regression: exiting fullscreen only cleared the styles and left the
    // shell parked at the top level, so the page's aspect-video box rendered
    // empty -- a black player.
    const claimed = { el: null as HTMLElement | null };
    const FakePage = makePage(claimed);
    mount(React.createElement(PlayerHost, null, React.createElement(FakePage)));
    await settle();
    await act(async () => {
      hostApi?.setSource(SESSION.playUrl, '');
      hostApi?.setSession(SESSION);
    });

    const shell = shellOf();
    const video = shell.querySelector('video');
    assert.ok(claimed.el?.contains(shell), 'precondition: on the page');

    // Enter, then leave.
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f' }));
    });
    assert.equal(shell.style.position, 'fixed');
    assert.notEqual(
      claimed.el?.contains(shell),
      true,
      'precondition: parked away from the page while fullscreen',
    );

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f' }));
    });

    assert.notEqual(shell.style.position, 'fixed', 'styles should be cleared');
    assert.equal(
      shell.style.width,
      '',
      'inline styles must be reset, not partially overwritten',
    );
    assert.equal(document.body.style.overflow, '', 'body scroll restored');
    assert.ok(
      claimed.el?.contains(shell),
      'video must return to the player page surface, not stay parked',
    );
    assert.equal(
      shell.querySelector('video'),
      video,
      'the same <video> must come back, not a new one',
    );
    assert.equal(shell.hidden, false, 'player must be visible again');
  });

  it('ignores the f shortcut while typing', async () => {
    mount(React.createElement(PlayerHost, null, React.createElement('div')));
    await settle();
    await act(async () => {
      hostApi?.setSource(SESSION.playUrl, '');
      hostApi?.setSession(SESSION);
    });

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'f', bubbles: true }),
      );
    });
    assert.notEqual(
      shellOf().style.position,
      'fixed',
      'typing in a field must not trigger fullscreen',
    );
  });

  it('drops the native controls in the mini bar', async () => {
    const claimed = { el: null as HTMLElement | null };
    const FakePage = makePage(claimed);
    let setPage: ((v: boolean) => void) | null = null;
    const Harness: React.FC = () => {
      const [show, setShow] = React.useState(true);
      setPage = setShow;
      return React.createElement(
        PlayerHost,
        null,
        show ? React.createElement(FakePage) : null,
      );
    };

    mount(React.createElement(Harness));
    await settle();
    await act(async () => {
      hostApi?.setSource(SESSION.playUrl, '');
      hostApi?.setSession(SESSION);
    });

    const onPage = shellOf().querySelector('video');
    assert.equal(
      onPage?.hasAttribute('controls'),
      true,
      'full player should keep the native control bar',
    );

    await act(async () => {
      setPage?.(false);
      await new Promise((r) => setTimeout(r, 40));
    });

    const inMini = shellOf().querySelector('video');
    assert.equal(
      inMini?.hasAttribute('controls'),
      false,
      'mini bar must not render native controls (volume button overlays the picture)',
    );
  });

  it('keeps the player visible in the mini bar (no audio-only bug)', async () => {
    const claimed = { el: null as HTMLElement | null };
    const FakePage = makePage(claimed);
    let setPage: ((v: boolean) => void) | null = null;
    const Harness: React.FC = () => {
      const [show, setShow] = React.useState(true);
      setPage = setShow;
      return React.createElement(
        PlayerHost,
        null,
        show ? React.createElement(FakePage) : null,
      );
    };

    mount(React.createElement(Harness));
    await settle();
    await act(async () => {
      hostApi?.setSource(SESSION.playUrl, '');
      hostApi?.setSession(SESSION);
    });
    await act(async () => {
      setPage?.(false);
      await new Promise((r) => setTimeout(r, 40));
    });

    const shell = shellOf();
    assert.ok(
      !shell.hasAttribute('hidden'),
      'shell must not be display:none while the mini bar is showing',
    );
    assert.notEqual(
      getComputedStyle(shell).display,
      'none',
      'mini bar player was invisible (sound but no picture)',
    );
  });

  it('never draws the mini bar over the full player', async () => {
    const claimed = { el: null as HTMLElement | null };
    const FakePage = makePage(claimed);
    mount(React.createElement(PlayerHost, null, React.createElement(FakePage)));
    await settle();

    // The surface appears only *after* loading finishes.
    await act(async () => {
      hostApi?.setSource(SESSION.playUrl, '');
      hostApi?.setSession(SESSION);
      const el = document.createElement('div');
      document.body.appendChild(el);
      claimed.el = el;
      hostApi?.attachSurface(el);
    });

    assert.equal(
      miniOf(),
      null,
      'mini bar must not render while the player page owns the surface',
    );
  });

  it('stays hidden when there is no session', async () => {
    mount(React.createElement(PlayerHost, null, React.createElement('div')));
    await settle();

    assert.equal(miniOf(), null, 'no session -> no mini bar');

    await act(async () => {
      hostApi?.setSource(SESSION.playUrl, '');
    });
    assert.equal(
      miniOf(),
      null,
      'a source without a session must not pop a mini bar',
    );
  });
});
