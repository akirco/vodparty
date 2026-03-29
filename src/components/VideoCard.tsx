import { ImageOff } from "lucide-react";
import React, { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Video } from "../types";

export const VideoCard: React.FC<{ video: Video; sourceId: string }> = ({
  video,
  sourceId,
}) => {
  const cardRef = useRef<HTMLAnchorElement>(null);
  const [imgError, setImgError] = useState(false);

  const handleMouseMove = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (!cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    cardRef.current.style.setProperty("--mouse-x", `${x}px`);
    cardRef.current.style.setProperty("--mouse-y", `${y}px`);
  };

  return (
    <Link
      to={`/video/${sourceId}/${video.vod_id}`}
      className="group block relative rounded-xl bg-zinc-900/40 p-2 border border-zinc-800/50 hover:border-zinc-700/50 transition-colors overflow-hidden"
      ref={cardRef}
      onMouseMove={handleMouseMove}
    >
      {/* Spotlight Overlay */}
      <div
        className="pointer-events-none absolute -inset-px rounded-xl opacity-0 transition duration-300 group-hover:opacity-100 z-30"
        style={{
          background:
            "radial-gradient(400px circle at var(--mouse-x, 0) var(--mouse-y, 0), rgba(59, 198, 188, 0.15), transparent 40%)",
        }}
      />

      <div className="relative aspect-3/4 overflow-hidden rounded-lg bg-zinc-800 z-20 flex items-center justify-center">
        {!imgError ? (
          <img
            src={video.vod_pic}
            alt={video.vod_name}
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
            referrerPolicy="no-referrer"
            loading="lazy"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="flex flex-col items-center justify-center text-zinc-600">
            <ImageOff className="w-12 h-12 mb-2 opacity-50" />
            <span className="text-xs font-medium uppercase tracking-wider opacity-50">
              No Image
            </span>
          </div>
        )}
        <div className="absolute inset-0 bg-linear-to-t from-black/90 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-4">
          <p className="text-white text-sm line-clamp-3 leading-relaxed">
            {(video.vod_content || "").replace(/<[^>]+>/g, "")}
          </p>
        </div>
        {video.vod_remarks && (
          <div className="absolute top-2 right-2 bg-black/60 backdrop-blur-md text-white text-[10px] uppercase font-bold tracking-wider px-2 py-1 rounded">
            {video.vod_remarks}
          </div>
        )}
      </div>
      <div className="mt-3 px-1 z-20 relative">
        <h3 className="text-sm font-medium text-white truncate group-hover:text-indigo-400 transition-colors">
          {video.vod_name}
        </h3>
        <p className="text-xs text-zinc-500 mt-1 truncate">
          {video.vod_year} • {video.type_name}
        </p>
      </div>
    </Link>
  );
};
