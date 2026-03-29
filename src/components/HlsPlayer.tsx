import Hls from "hls.js";
import React, { useEffect, useRef } from "react";

interface HlsPlayerProps {
  src: string;
  poster?: string;
  initialTime?: number;
  videoRef?: React.RefObject<HTMLVideoElement | null>;
  onPlay?: () => void;
  onPause?: () => void;
  onSeeked?: () => void;
  onTimeUpdate?: () => void;
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
}) => {
  const internalVideoRef = useRef<HTMLVideoElement>(null);
  const videoRef = externalVideoRef || internalVideoRef;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let hls: Hls | null = null;

    const handleLoadedMetadata = () => {
      if (initialTime > 0 && video.currentTime === 0) {
        video.currentTime = initialTime;
      }
    };
    video.addEventListener("loadedmetadata", handleLoadedMetadata);

    if (Hls.isSupported()) {
      hls = new Hls();
      hls.loadSource(src);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        // Autoplay is often blocked by browsers, so we leave it to user interaction
      });
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = src;
    }

    return () => {
      video.removeEventListener("loadedmetadata", handleLoadedMetadata);
      if (hls) {
        hls.destroy();
      }
    };
  }, [src, videoRef, initialTime]);

  return (
    <video
      ref={videoRef}
      className="w-full h-full bg-black"
      controls
      poster={poster}
      playsInline
      onPlay={onPlay}
      onPause={onPause}
      onSeeked={onSeeked}
      onTimeUpdate={onTimeUpdate}
    />
  );
};
