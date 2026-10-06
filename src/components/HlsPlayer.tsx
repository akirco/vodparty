import type HlsType from 'hls.js';
import type { ErrorData } from 'hls.js';
import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * hls.js is ~575 kB (the single largest dependency here) and is only truly
 * needed when the engine has no native HLS support, or when native playback
 * failed. Loading it on demand keeps it out of the initial payload entirely:
 * Safari/WebKit users playing via native HLS never fetch it at all.
 */
let hlsModulePromise: Promise<typeof HlsType> | null = null;
const loadHls = (): Promise<typeof HlsType> =>
  (hlsModulePromise ??= import('hls.js').then((m) => m.default));

type Strategy = 'auto' | 'native' | 'hlsjs';
type ResolvedStrategy = 'native' | 'hlsjs' | 'none';

export interface PlayerError {
  stage: 'setup' | 'hlsjs' | 'native' | 'media';
  type?: string;
  details?: string;
  reason?: string;
  fatal: boolean;
  url?: string;
  mimeType?: string;
  network?: { status?: number; code?: number; text?: string };
  message: string;
}

interface HlsPlayerProps {
  src: string;
  poster?: string;
  initialTime?: number;
  videoRef?: React.RefObject<HTMLVideoElement | null>;
  onPlay?: () => void;
  onPause?: () => void;
  onSeeked?: () => void;
  onTimeUpdate?: () => void;
  onEnded?: () => void;
  onError?: (error: PlayerError) => void;
  strategy?: Strategy;
  /**
   * Show the browser's native control bar.
   *
   * Turn this off when the element is rendered somewhere compact (the mini
   * player): the native bar crams a volume button into the top-right corner
   * and swallows clicks meant for "click to go back to the player".
   */
  controls?: boolean;
  debug?: boolean;
  /** How long to wait for metadata before abandoning a strategy. */
  nativeTimeoutMs?: number;
}

const LOG_PREFIX = '[HlsPlayer]';

/** Milliseconds to wait for `loadedmetadata` before falling back. */
const DEFAULT_NATIVE_TIMEOUT = 8000;

/** How many times a source may switch strategy before we give up on it. */
const MAX_FALLBACKS = 2;

function log(debug: boolean, ...args: unknown[]) {
  if (debug) console.log(LOG_PREFIX, ...args);
}

function logAlways(...args: unknown[]) {
  console.log(LOG_PREFIX, ...args);
}

function describeErrorData(data: ErrorData): PlayerError {
  const net = data.networkDetails as
    | { status?: number; code?: number; text?: string }
    | undefined;
  const status = net?.status ?? data.response?.code;

  const message =
    data.reason ||
    (data.error instanceof Error ? data.error.message : undefined) ||
    data.details ||
    'unknown hls.js error';

  return {
    stage: 'hlsjs',
    type: data.type,
    details: data.details,
    reason: data.reason,
    fatal: Boolean(data.fatal),
    url: data.url ?? data.frag?.url,
    mimeType: data.mimeType,
    network: net
      ? { status, code: net.code, text: net.text }
      : status
        ? { status }
        : undefined,
    message,
  };
}

function formatError(error: PlayerError): string {
  const parts = [`[${error.stage}]`];
  if (error.type) parts.push(error.type);
  if (error.details) parts.push(error.details);
  if (error.url) parts.push(`url=${error.url}`);
  if (error.network?.status) parts.push(`status=${error.network.status}`);
  if (error.network?.code) parts.push(`code=${error.network.code}`);
  if (error.mimeType) parts.push(`mime=${error.mimeType}`);
  parts.push(error.fatal ? 'FATAL' : 'non-fatal');
  parts.push(`- ${error.message}`);
  return parts.join(' ');
}

export const HlsPlayer: React.FC<HlsPlayerProps> = ({
  src,
  poster,
  initialTime = 0,
  videoRef: externalVideoRef,
  onPlay,
  onPause,
  onSeeked,
  onTimeUpdate,
  onEnded,
  onError,
  strategy = 'auto',
  controls = true,
  debug = false,
  nativeTimeoutMs = DEFAULT_NATIVE_TIMEOUT,
}) => {
  const internalVideoRef = useRef<HTMLVideoElement>(null);
  const videoRef = externalVideoRef || internalVideoRef;

  const [resolved, setResolved] = useState<ResolvedStrategy>('none');
  const [lastError, setLastError] = useState<PlayerError | null>(null);
  // The hls.js constructor, populated on demand. `null` means "not fetched".
  const [Hls, setHls] = useState<typeof HlsType | null>(null);

  // Lets the effect re-run and try the next strategy.
  const [attempt, setAttempt] = useState(0);
  // Fallback bookkeeping for the current `src`. This MUST survive effect
  // re-runs (it is only reset when `src` changes): the fallback paths below
  // re-enter this effect via `setAttempt`, so per-run state would let
  // native -> hls.js -> native -> hls.js spin forever, rebuilding the player
  // every `nativeTimeoutMs`. The `count` cap bounds the total retries.
  const fallback = useRef<{ src: string | null; count: number }>({
    src: null,
    count: 0,
  });

  const reportError = useCallback(
    (error: PlayerError) => {
      console.error(LOG_PREFIX, formatError(error), error);
      setLastError(error);
      onError?.(error);
    },
    [onError],
  );

  // Some reported errors are recoverable (a native timeout that falls back to
  // hls.js). Without this the failure overlay would stay on top of a video
  // that ended up playing fine.
  const clearError = useCallback(() => setLastError(null), []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // Reset any previous media state before re-attaching.
    setResolved('none');

    if (fallback.current.src !== src) {
      fallback.current = { src, count: 0 };
    }
    // Bounds the native <-> hls.js fallback chain so it always terminates.
    const canRetry = fallback.current.count < MAX_FALLBACKS;

    const canPlayNative = Boolean(
      video.canPlayType('application/vnd.apple.mpegurl'),
    );
    const msePresent = typeof window.MediaSource !== 'undefined';
    // Native already failed for this exact source: don't pick it again.
    const nativeExhausted = fallback.current.count > 0;

    // If this path needs hls.js and it hasn't been fetched yet, fetch it and
    // bail; setting `Hls` re-runs this effect with the library in hand.
    const needsHls = strategy === 'hlsjs' || !canPlayNative || nativeExhausted;
    if (needsHls && !Hls) {
      let cancelled = false;
      loadHls()
        .then((mod) => {
          // MUST be wrapped: `mod` is a class, and React treats a bare
          // function passed to a state setter as an updater and invokes it
          // ("class constructors must be invoked with 'new'").
          if (!cancelled) setHls(() => mod);
        })
        .catch((err) => {
          if (cancelled) return;
          reportError({
            stage: 'hlsjs',
            fatal: true,
            message: `Failed to load hls.js: ${
              err instanceof Error ? err.message : 'unknown error'
            }`,
          });
        });
      return () => {
        cancelled = true;
      };
    }

    // Whether hls.js can actually run here. When it hasn't been fetched we
    // have not disproved it, so the native-timeout fallback still attempts it
    // (which triggers the load above on the next run).
    const canTryHls = Hls ? Hls.isSupported() : true;
    const hlsSupported = Hls ? Hls.isSupported() : false;

    log(debug, 'capabilities', {
      ua: navigator.userAgent,
      canPlayNative,
      mpegurl: video.canPlayType('application/vnd.apple.mpegurl'),
      mp4: video.canPlayType('video/mp4; codecs="avc1.42E01E"'),
      msePresent,
      hlsSupported,
      strategy,
      src,
    });

    let chosen: ResolvedStrategy;
    if (strategy === 'native') {
      chosen = 'native';
    } else if (strategy === 'hlsjs') {
      chosen = 'hlsjs';
    } else if (canPlayNative && !nativeExhausted) {
      chosen = 'native';
    } else if (hlsSupported) {
      chosen = 'hlsjs';
    } else if (canPlayNative) {
      // Nothing left to try, but native HLS still is: give it one last chance
      // with no watchdog armed so it cannot spin.
      chosen = 'native';
    } else {
      chosen = 'none';
    }

    if (chosen === 'none') {
      reportError({
        stage: 'setup',
        fatal: true,
        message:
          'No usable HLS playback path: MediaSource Extensions unavailable and ' +
          'the engine reports no native HLS support (application/vnd.apple.mpegurl).',
      });
      return;
    }

    let hls: InstanceType<typeof HlsType> | null = null;
    let settled = false;
    let watchdog: ReturnType<typeof setTimeout> | null = null;

    const cleanupWatchdog = () => {
      if (watchdog) {
        clearTimeout(watchdog);
        watchdog = null;
      }
    };

    const markSettled = () => {
      settled = true;
      cleanupWatchdog();
    };

    const handleLoadedMetadata = () => {
      log(debug, 'loadedmetadata');
      markSettled();
      clearError();
      if (initialTime > 0 && video.currentTime === 0) {
        log(debug, `seeking to initialTime=${initialTime}`);
        video.currentTime = initialTime;
      }
    };

    const handleMediaError = () => {
      const err = video.error;
      if (!err) return;
      reportError({
        stage: 'media',
        fatal: true,
        type: `MediaError.${err.code}`,
        message: err.message || `video element error code ${err.code}`,
        network: {
          status: err.code === MediaError.MEDIA_ERR_NETWORK ? 0 : undefined,
        },
      });
    };

    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    video.addEventListener('error', handleMediaError);

    /**
     * Native playback stalled (common on WebKitGTK when the m3u8 needs custom
     * headers). Tear it down and let hls.js try instead.
     */
    const handleNativeTimeout = () => {
      if (settled) return;
      const willFallBack = canTryHls && canRetry;
      logAlways(
        `native playback produced no loadedmetadata within ${nativeTimeoutMs}ms, ` +
          (willFallBack ? 'falling back to hls.js' : 'giving up'),
      );
      reportError({
        stage: 'native',
        fatal: false,
        message: `No loadedmetadata within ${nativeTimeoutMs}ms using native HLS playback`,
      });

      if (willFallBack) {
        video.removeAttribute('src');
        video.load();
        fallback.current.count += 1;
        setAttempt((n) => n + 1);
      } else {
        markSettled();
      }
    };

    if (chosen === 'native') {
      log(debug, 'attaching native HLS', src);
      video.src = src;
      video.load();
      setResolved('native');
      if (!nativeExhausted) {
        watchdog = setTimeout(handleNativeTimeout, nativeTimeoutMs);
      }
    } else {
      log(debug, 'attaching hls.js (MSE)', src);
      setResolved('hlsjs');

      // Narrowed for TS; the guard above guarantees this is loaded here.
      const HlsCtor = Hls;
      if (!HlsCtor) {
        reportError({
          stage: 'setup',
          fatal: true,
          message: 'hls.js was selected but is not loaded.',
        });
        return;
      }

      hls = new HlsCtor({
        // These CMS streams are plain VOD, so low-latency mode buys nothing
        // and costs extra playlist churn.
        lowLatencyMode: false,
        // Cap the back buffer: a 90s back buffer on a multi-hour episode is a
        // lot of retained memory for no benefit.
        backBufferLength: 30,
      });

      hls.on(HlsCtor.Events.ERROR, (_event, data) => {
        const err = describeErrorData(data);
        const line = formatError(err);
        if (err.fatal) console.error(LOG_PREFIX, line, data);
        else log(debug, line, data);

        if (!err.fatal) return;

        markSettled();

        switch (data.type) {
          case HlsCtor.ErrorTypes.NETWORK_ERROR:
            // Manifest/segment fetch failed. Native playback bypasses CORS,
            // so it is often the only thing that still works.
            logAlways('fatal network error, trying native playback', line);
            if (canPlayNative && canRetry) {
              hls?.destroy();
              hls = null;
              fallback.current.count += 1;
              setAttempt((n) => n + 1);
            } else {
              reportError(err);
            }
            break;

          case HlsCtor.ErrorTypes.MEDIA_ERROR:
            logAlways('fatal media error, attempting recoverMediaError', line);
            hls?.recoverMediaError();
            break;

          default:
            reportError(err);
            break;
        }
      });

      hls.on(HlsCtor.Events.MANIFEST_LOADING, (_e, d) =>
        log(debug, 'MANIFEST_LOADING', d.url),
      );
      hls.on(HlsCtor.Events.MANIFEST_PARSED, (_e, d) => {
        log(debug, 'MANIFEST_PARSED levels=', d.levels?.length);
        markSettled();
        clearError();
      });
      hls.on(HlsCtor.Events.LEVEL_LOADED, (_e, d) => {
        const details = d.details as
          | { level?: number; fragments?: unknown[] }
          | undefined;
        log(
          debug,
          `LEVEL_LOADED ${details?.level} fragments=${details?.fragments?.length ?? 0}`,
        );
      });
      hls.on(HlsCtor.Events.FRAG_LOADED, (_e, d) =>
        log(
          debug,
          `FRAG_LOADED sn=${d.frag?.sn} bytes=${d.frag?.stats?.total}`,
        ),
      );
      hls.on(HlsCtor.Events.BUFFER_APPENDED, () => markSettled());

      hls.attachMedia(video);
      hls.on(HlsCtor.Events.MEDIA_ATTACHED, () => {
        log(debug, 'MEDIA_ATTACHED, loading source');
        hls?.loadSource(src);
      });

      // Guard against a sourceopen that never arrives.
      watchdog = setTimeout(() => {
        if (settled || !hls) return;
        logAlways('hls.js produced no manifest/buffer activity, giving up');
        reportError({
          stage: 'hlsjs',
          fatal: true,
          message:
            'hls.js attached a MediaSource but never parsed the manifest or ' +
            'appended a buffer. The engine likely cannot build a decode pipeline.',
        });
        markSettled();
      }, nativeTimeoutMs);
    }

    return () => {
      cleanupWatchdog();
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('error', handleMediaError);
      if (hls) {
        hls.destroy();
      }
    };
  }, [
    src,
    videoRef,
    initialTime,
    strategy,
    debug,
    nativeTimeoutMs,
    attempt,
    reportError,
    clearError,
    Hls,
  ]);

  return (
    <>
      <video
        ref={videoRef}
        className="w-full h-full bg-black"
        controls={controls}
        autoPlay
        poster={poster}
        playsInline
        onPlay={onPlay}
        onPause={onPause}
        onSeeked={onSeeked}
        onTimeUpdate={onTimeUpdate}
        onEnded={onEnded}
      />

      {(resolved === 'none' || lastError) && (
        <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-2 bg-black/85 p-6 text-center">
          <p className="text-sm font-medium text-red-400">
            Playback failed ({resolved === 'none' ? 'setup' : resolved})
          </p>
          <p className="max-w-xl font-mono text-xs leading-relaxed text-zinc-400 break-words">
            {lastError
              ? formatError(lastError)
              : 'No usable playback path detected.'}
          </p>
          <p className="text-xs text-zinc-600">
            See the browser console for the full [HlsPlayer] log.
          </p>
        </div>
      )}
    </>
  );
};
