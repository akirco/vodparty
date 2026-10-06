import { Maximize, Minimize, X } from 'lucide-react';
import type React from 'react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { flushHistory, saveHistoryItem } from '../services/history';
import { HlsPlayer } from './HlsPlayer';

/** How often playback progress is pushed into the watch history. */
const HISTORY_SAVE_INTERVAL_MS = 5000;

/** Everything the mini player needs to describe what is playing. */
export interface PlaybackSession {
  videoId: number;
  videoName: string;
  videoPic: string;
  sourceId: string;
  groupName: string;
  playUrl: string;
  episodeIndex: number;
}

interface PlayerHostValue {
  /** Called by the player page to receive the persistent <video> element. */
  attachSurface: (el: HTMLElement | null) => void;
  /** Set the stream to play. No-op when unchanged, so remounts do not reload. */
  setSource: (src: string, poster: string, initialTime?: number) => void;
  /** Metadata for history + the mini bar; retained after the page unmounts. */
  setSession: (session: PlaybackSession | null) => void;
  /** Page-supplied hook, cleared when the page unmounts. */
  setOnEnded: (fn: (() => void) | null) => void;
  /** play/pause/seek notifier, so watch-party sync survives mini mode. */
  setOnPlaybackEvent: (
    fn: ((action: 'play' | 'pause' | 'seek') => void) | null,
  ) => void;
  /** Remote party commands need the live element. */
  getVideo: () => HTMLVideoElement | null;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  /** Stop playback and forget the session. */
  close: () => void;
  seek: (time: number) => void;
  togglePictureInPicture: () => Promise<void>;
  /**
   * CSS fullscreen for the video itself.
   *
   * Deliberately owned by the host rather than the player page: the video now
   * outlives that route, so a shortcut bound to the page would simply stop
   * working the moment playback continues in the mini bar.
   */
  isFullscreen: boolean;
  toggleFullscreen: () => void;
}

const PlayerHostContext = createContext<PlayerHostValue | null>(null);

/**
 * Owns a single, never-unmounted video element and keeps it alive across route
 * changes.
 *
 * Previously <HlsPlayer> lived inside the /video/:id page, so navigating away
 * unmounted it, destroyed the hls.js instance and stopped playback. Here the
 * player is mounted once in the layout (above <Outlet/>) and the page's
 * placeholder element is used as a mount point: the player shell is
 * *re-parented* into whichever surface is active (full page or mini bar) via
 * appendChild, which moves the DOM node without remounting React or
 * re-initialising the stream.
 */
export const PlayerHost: React.FC<{ children?: React.ReactNode }> = ({
  children,
}) => {
  const miniSurfaceRef = useRef<HTMLDivElement>(null);
  const parkRef = useRef<HTMLDivElement>(null);
  const surfaceElRef = useRef<HTMLElement | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  /**
   * The player shell is a plain DOM node that React does NOT own.
   *
   * React used to render it as a normal child, but re-parenting it with
   * appendChild meant React later tried to remove it from a parent it was no
   * longer a child of ("The node to be removed is not a child of this node").
   * Owning the node ourselves and portaling the player *into* it keeps the
   * container identity stable, so the <video> is never recreated, while React
   * only ever manages nodes inside it.
   */
  const shellEl = useMemo(() => {
    const el = document.createElement('div');
    el.dataset.playerShell = '';
    el.className = 'relative h-full w-full';
    return el;
  }, []);

  const [src, setSrc] = useState('');
  const [poster, setPoster] = useState('');
  const [session, setSession] = useState<PlaybackSession | null>(null);

  // Is a player page currently mounted and showing the full surface?
  const [pageActive, setPageActive] = useState(false);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [pipActive, setPipActive] = useState(false);
  const [pipSupported, setPipSupported] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  /** Mini bar only when something is playing and no page owns the surface. */
  const showMini = Boolean(session) && !pageActive;
  const progress =
    duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;

  const onEndedRef = useRef<(() => void) | null>(null);
  const onPlaybackEventRef = useRef<
    ((action: 'play' | 'pause' | 'seek') => void) | null
  >(null);
  const sessionRef = useRef<PlaybackSession | null>(null);
  const lastSaveAt = useRef(0);
  /**
   * Resume offset, applied once the new stream reports metadata.
   *
   * Deliberately not passed to <HlsPlayer initialTime>: that prop is in the
   * player's effect dependencies, so changing it re-ran the whole attach path
   * and tore down + rebuilt the hls.js instance. Keeping it here avoids that.
   */
  const pendingSeekRef = useRef(0);

  sessionRef.current = session;

  // Feature-detect native Picture-in-Picture. Available in WebView2 (Windows)
  // and Chrome/Safari/Edge; NOT in WebKitGTK on Linux, so it stays hidden
  // there rather than throwing.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    setPipSupported(Boolean(document.pictureInPictureEnabled));
  }, []);

  const attachSurface = useCallback((el: HTMLElement | null) => {
    // Only record the surface: placement is decided by the single
    // placement/styling effect, which must also know about fullscreen.
    surfaceElRef.current = el;
    setPageActive(Boolean(el));
  }, []);

  /**
   * Single owner of where the shell lives and how it looks.
   *
   * Placement and styling used to live in three effects with different
   * dependency lists, so leaving fullscreen re-ran none of them and the video
   * stayed in the parking node -- the player page then showed an empty black
   * box. One effect, one decision.
   *
   * Fullscreen parks the shell in the top-level node first: the mini bar uses
   * `backdrop-blur`, and an ancestor's backdrop-filter creates a containing
   * block that would trap a `position: fixed` descendant inside the bar.
   */
  useEffect(() => {
    const fallback = miniSurfaceRef.current ?? parkRef.current;
    const destination = isFullscreen
      ? (parkRef.current ?? fallback)
      : ((pageActive ? surfaceElRef.current : null) ?? fallback);

    if (destination && shellEl.parentElement !== destination) {
      destination.appendChild(shellEl);
    }

    if (isFullscreen) {
      Object.assign(shellEl.style, {
        position: 'fixed',
        inset: '0',
        width: '100vw',
        height: '100vh',
        background: '#000',
        zIndex: '100',
      });
      document.body.style.overflow = 'hidden';
    } else {
      shellEl.style.cssText = '';
      document.body.style.overflow = '';
    }

    // Hidden only when there is genuinely nowhere to show it.
    shellEl.hidden = !src || (!isFullscreen && !pageActive && !showMini);
  }, [isFullscreen, pageActive, showMini, src, shellEl]);

  const toggleFullscreen = useCallback(() => {
    setIsFullscreen((prev) => !prev);
  }, []);

  // Leaving fullscreen when there is nothing to play would trap the user in a
  // black screen.
  useEffect(() => {
    if (!src && isFullscreen) setIsFullscreen(false);
  }, [src, isFullscreen]);

  // `f` toggles fullscreen, Escape leaves it. Bound to the window so it works
  // regardless of which route is mounted.
  useEffect(() => {
    if (!src) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable;
      if (typing) return;

      if (e.key === 'Escape' && isFullscreen) {
        setIsFullscreen(false);
        return;
      }
      if (e.key === 'f' || e.key === 'F') {
        setIsFullscreen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [src, isFullscreen]);

  const setSource = useCallback(
    (next: string, nextPoster: string, time = 0) => {
      setSrc((prev) => {
        // Identity check: coming back to the same video must not reload it.
        if (prev !== next) pendingSeekRef.current = time;
        return prev === next ? prev : next;
      });
      setPoster((prev) => (prev === nextPoster ? prev : nextPoster));
    },
    [],
  );

  const getVideo = useCallback(() => videoRef.current, []);

  const play = useCallback(() => {
    void videoRef.current?.play().catch(() => {});
  }, []);

  const pause = useCallback(() => videoRef.current?.pause(), []);

  const toggle = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => {});
    else v.pause();
  }, []);

  const close = useCallback(() => {
    videoRef.current?.pause();
    setSrc('');
    setSession(null);
    sessionRef.current = null;
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    onEndedRef.current = null;
    void flushHistory();
  }, []);

  const seek = useCallback((time: number) => {
    const v = videoRef.current;
    if (v) v.currentTime = time;
  }, []);

  const togglePictureInPicture = useCallback(async () => {
    const v = videoRef.current;
    if (!v) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await v.requestPictureInPicture();
      }
    } catch (err) {
      // Autoplay policy or an unsupported engine; not worth surfacing.
      console.warn('[PlayerHost] Picture-in-Picture failed:', err);
    }
  }, []);

  // Native PiP exits when the document hides; keep the flag honest.
  useEffect(() => {
    const onEnter = () => setPipActive(true);
    const onLeave = () => setPipActive(false);
    document.addEventListener('enterpictureinpicture', onEnter);
    document.addEventListener('leavepictureinpicture', onLeave);
    return () => {
      document.removeEventListener('enterpictureinpicture', onEnter);
      document.removeEventListener('leavepictureinpicture', onLeave);
    };
  }, []);

  // Apply the resume offset once, when the stream is ready for it.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const apply = () => {
      const target = pendingSeekRef.current;
      if (target > 0 && video.currentTime === 0) {
        video.currentTime = target;
      }
      pendingSeekRef.current = 0;
    };
    video.addEventListener('loadedmetadata', apply);
    return () => video.removeEventListener('loadedmetadata', apply);
  }, [src]);

  // Persist progress even while the player page is not mounted, so the mini
  // bar does not silently stop recording.
  const handleTimeUpdate = useCallback(() => {
    const v = videoRef.current;
    const s = sessionRef.current;
    if (!v || !s) return;

    setCurrentTime(v.currentTime);
    if (Number.isFinite(v.duration)) setDuration(v.duration);

    const now = Date.now();
    if (now - lastSaveAt.current < HISTORY_SAVE_INTERVAL_MS) return;
    lastSaveAt.current = now;

    void saveHistoryItem({
      videoId: s.videoId,
      videoName: s.videoName,
      videoPic: s.videoPic,
      sourceId: s.sourceId,
      groupName: s.groupName,
      playUrl: s.playUrl,
      episodeIndex: s.episodeIndex,
      currentTime: v.currentTime,
      duration: Number.isFinite(v.duration) ? v.duration : 0,
    });
  }, []);

  // Flush pending progress on teardown so the last few seconds are not lost.
  useEffect(() => {
    const flush = () => void flushHistory();
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('beforeunload', flush);
      flush();
    };
  }, []);

  const value = useMemo<PlayerHostValue>(
    () => ({
      attachSurface,
      setSource,
      setSession,
      setOnEnded: (fn) => {
        onEndedRef.current = fn;
      },
      setOnPlaybackEvent: (fn) => {
        onPlaybackEventRef.current = fn;
      },
      getVideo,
      play,
      pause,
      toggle,
      close,
      seek,
      togglePictureInPicture,
      isFullscreen,
      toggleFullscreen,
    }),
    [
      attachSurface,
      setSource,
      getVideo,
      play,
      pause,
      toggle,
      close,
      seek,
      togglePictureInPicture,
      isFullscreen,
      toggleFullscreen,
    ],
  );

  return (
    <PlayerHostContext.Provider value={value}>
      {children}

      {/*
        The persistent player, portaled into the shell node we own. Always
        mounted -- only ever hidden -- so the media element is never
        re-created. It must stay VISIBLE whenever it has a destination (the
        player page or the mini bar); hiding it whenever the page unmounts was
        the "audio but no picture" bug.
      */}
      {createPortal(
        <HlsPlayer
          src={src}
          poster={poster}
          videoRef={videoRef}
          // Native controls only make sense on the full player page. In the
          // mini bar they crowd the picture and block click-to-return.
          controls={pageActive}
          onPlay={() => {
            setIsPlaying(true);
            onPlaybackEventRef.current?.('play');
          }}
          onPause={() => {
            setIsPlaying(false);
            void flushHistory();
            onPlaybackEventRef.current?.('pause');
          }}
          onSeeked={() => onPlaybackEventRef.current?.('seek')}
          onTimeUpdate={handleTimeUpdate}
          onEnded={() => onEndedRef.current?.()}
        />,
        shellEl,
      )}

      {/*
        Always-present parking spot, so the shell is never left attached to a
        page that is being unmounted -- and it hosts the video during
        fullscreen.

        Deliberately NOT `hidden`: this node is the fullscreen container, so
        hiding it produced a black screen. Visibility is the shell's own
        business (`shellEl.hidden`); this empty div has no size of its own.
      */}
      <div ref={parkRef} aria-hidden />

      {/* Mini player: the same element is re-parented in here on navigation. */}
      {showMini && (
        <div
          className="fixed bottom-4 right-4 z-50 w-80 overflow-hidden rounded-xl
            border border-zinc-800 bg-zinc-900/95 shadow-2xl backdrop-blur-md"
        >
          {/* Clicking the picture returns to the player, like any video mini player. */}
          <Link
            to={`/video/${session?.sourceId}/${session?.videoId}`}
            className="block"
            title="Back to player"
          >
            <div
              ref={miniSurfaceRef}
              data-mini-surface=""
              className="relative aspect-video bg-black"
            />
          </Link>

          <div className="flex items-center gap-2 px-3 py-2">
            <button
              type="button"
              onClick={toggle}
              className="flex h-8 w-8 shrink-0 items-center justify-center
                rounded-full bg-zinc-800 text-white transition-colors
                hover:bg-indigo-600"
              aria-label={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? (
                <span className="flex gap-[3px]" aria-hidden>
                  <span className="h-3 w-[3px] rounded-sm bg-current" />
                  <span className="h-3 w-[3px] rounded-sm bg-current" />
                </span>
              ) : (
                <span
                  className="ml-0.5 h-0 w-0 border-y-[6px] border-l-[10px]
                    border-y-transparent border-l-current"
                  aria-hidden
                />
              )}
            </button>

            <Link
              to={`/video/${session?.sourceId}/${session?.videoId}`}
              className="min-w-0 flex-1"
              title="Back to player"
            >
              <p className="truncate text-sm font-medium text-white">
                {session?.videoName}
              </p>
              <p className="truncate text-xs text-zinc-500">
                {session?.groupName} · Ep {(session?.episodeIndex ?? 0) + 1}
              </p>
            </Link>

            <button
              type="button"
              onClick={toggleFullscreen}
              className={`flex h-8 w-8 shrink-0 items-center justify-center
                rounded-md transition-colors ${
                  isFullscreen
                    ? 'bg-indigo-600 text-white'
                    : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'
                }`}
              aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              title={isFullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen (F)'}
            >
              {isFullscreen ? (
                <Minimize className="h-4 w-4" />
              ) : (
                <Maximize className="h-4 w-4" />
              )}
            </button>

            {pipSupported && (
              <button
                type="button"
                onClick={() => void togglePictureInPicture()}
                className={`flex h-8 w-8 shrink-0 items-center justify-center
                  rounded-md transition-colors ${
                    pipActive
                      ? 'bg-indigo-600 text-white'
                      : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'
                  }`}
                aria-label="Picture in Picture"
                title="Picture in Picture"
              >
                <PipIcon />
              </button>
            )}

            <button
              type="button"
              onClick={close}
              className="flex h-8 w-8 shrink-0 items-center justify-center
                rounded-md text-zinc-400 transition-colors
                hover:bg-red-600 hover:text-white"
              aria-label="Stop playback"
              title="Stop"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="h-0.5 bg-zinc-800">
            <div
              className="h-full bg-indigo-500 transition-[width]"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}
    </PlayerHostContext.Provider>
  );
};

/** Small "picture in picture" glyph, drawn inline to avoid another icon dep. */
const PipIcon: React.FC = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="h-4 w-4"
    aria-hidden
  >
    <rect x="2" y="4" width="20" height="16" rx="2" />
    <rect
      x="12"
      y="12"
      width="8"
      height="6"
      rx="1"
      fill="currentColor"
      stroke="none"
    />
  </svg>
);

export const usePlayerHost = (): PlayerHostValue => {
  const ctx = useContext(PlayerHostContext);
  if (!ctx) {
    throw new Error('usePlayerHost must be used inside <PlayerHost>');
  }
  return ctx;
};
