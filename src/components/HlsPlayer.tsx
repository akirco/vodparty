import Hls, { type ErrorData } from 'hls.js';
import React, { useCallback, useEffect, useRef, useState } from 'react';

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
  debug?: boolean;
  /** How long to wait for metadata before abandoning a strategy. */
  nativeTimeoutMs?: number;
}

const LOG_PREFIX = '[HlsPlayer]';

/** Milliseconds to wait for `loadedmetadata` before falling back. */
const DEFAULT_NATIVE_TIMEOUT = 8000;

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
  debug = true,
  nativeTimeoutMs = DEFAULT_NATIVE_TIMEOUT,
}) => {
  const internalVideoRef = useRef<HTMLVideoElement>(null);
  const videoRef = externalVideoRef || internalVideoRef;

  const [resolved, setResolved] = useState<ResolvedStrategy>('none');
  const [lastError, setLastError] = useState<PlayerError | null>(null);

  // Lets the effect re-run and try the next strategy.
  const [attempt, setAttempt] = useState(0);
  const usedFallback = useRef(false);

  const reportError = useCallback(
    (error: PlayerError) => {
      console.error(LOG_PREFIX, formatError(error), error);
      setLastError(error);
      onError?.(error);
    },
    [onError],
  );

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // Reset any previous media state before re-attaching.
    usedFallback.current = false;
    setResolved('none');

    const canPlayNative = Boolean(
      video.canPlayType('application/vnd.apple.mpegurl'),
    );
    const msePresent = typeof window.MediaSource !== 'undefined';
    const hlsSupported = Hls.isSupported();

    logAlways('capabilities', {
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
    } else if (canPlayNative) {
      chosen = 'native';
    } else if (hlsSupported) {
      chosen = 'hlsjs';
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

    let hls: Hls | null = null;
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
        network: { status: err.code === MediaError.MEDIA_ERR_NETWORK ? 0 : undefined },
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
      logAlways(
        `native playback produced no loadedmetadata within ${nativeTimeoutMs}ms, falling back`,
      );
      reportError({
        stage: 'native',
        fatal: false,
        message: `No loadedmetadata within ${nativeTimeoutMs}ms using native HLS playback`,
      });

      if (hlsSupported) {
        video.removeAttribute('src');
        video.load();
        usedFallback.current = true;
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
      if (!usedFallback.current) {
        watchdog = setTimeout(handleNativeTimeout, nativeTimeoutMs);
      }
    } else {
      log(debug, 'attaching hls.js (MSE)', src);
      setResolved('hlsjs');

      hls = new Hls({
        enableWorker: false,
        lowLatencyMode: true,
        backBufferLength: 90,
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        const err = describeErrorData(data);
        const line = formatError(err);
        if (err.fatal) console.error(LOG_PREFIX, line, data);
        else log(debug, line, data);

        if (!err.fatal) return;

        markSettled();

        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            // Manifest/segment fetch failed. Native playback bypasses CORS,
            // so it is often the only thing that still works.
            logAlways('fatal network error, trying native playback', line);
            if (canPlayNative) {
              hls?.destroy();
              hls = null;
              usedFallback.current = true;
              setAttempt((n) => n + 1);
            } else {
              reportError(err);
            }
            break;

          case Hls.ErrorTypes.MEDIA_ERROR:
            logAlways('fatal media error, attempting recoverMediaError', line);
            hls?.recoverMediaError();
            break;

          default:
            reportError(err);
            break;
        }
      });

      hls.on(Hls.Events.MANIFEST_LOADING, (_e, d) =>
        log(debug, 'MANIFEST_LOADING', d.url),
      );
      hls.on(Hls.Events.MANIFEST_PARSED, (_e, d) => {
        log(debug, 'MANIFEST_PARSED levels=', d.levels?.length);
        markSettled();
      });
      hls.on(Hls.Events.LEVEL_LOADED, (_e, d) => {
        const details = d.details as
          | { level?: number; fragments?: unknown[] }
          | undefined;
        log(
          debug,
          `LEVEL_LOADED ${details?.level} fragments=${details?.fragments?.length ?? 0}`,
        );
      });
      hls.on(Hls.Events.FRAG_LOADED, (_e, d) =>
        log(debug, `FRAG_LOADED sn=${d.frag?.sn} bytes=${d.frag?.stats?.total}`),
      );
      hls.on(Hls.Events.BUFFER_APPENDED, () => markSettled());

      hls.attachMedia(video);
      hls.on(Hls.Events.MEDIA_ATTACHED, () => {
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
  ]);

  return (
    <>
      <video
        ref={videoRef}
        className="w-full h-full bg-black"
        controls
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
