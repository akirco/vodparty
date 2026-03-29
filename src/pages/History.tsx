import { Clock, ImageOff, PlayCircle, Trash2 } from "lucide-react";
import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  clearHistory,
  getHistory,
  HistoryItem,
  removeHistoryItem,
} from "../services/history";

const HistoryCard: React.FC<{
  item: HistoryItem;
  onRemove: (e: React.MouseEvent, videoId: number) => void;
  formatTime: (seconds: number) => string;
}> = ({ item, onRemove, formatTime }) => {
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

  const progress =
    item.duration > 0 ? (item.currentTime / item.duration) * 100 : 0;

  return (
    <Link
      to={`/video/${item.sourceId}/${item.videoId}`}
      className="group relative bg-zinc-900/40 rounded-xl overflow-hidden border border-zinc-800/50 hover:border-zinc-700/50 transition-all p-2 block"
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

      <div className="aspect-video relative overflow-hidden rounded-lg bg-zinc-800 z-20 flex items-center justify-center">
        {!imgError ? (
          <img
            src={item.video.vod_pic}
            alt={item.video.vod_name}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            referrerPolicy="no-referrer"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="flex flex-col items-center justify-center text-zinc-600">
            <ImageOff className="w-8 h-8 mb-1 opacity-50" />
            <span className="text-[10px] font-medium uppercase tracking-wider opacity-50">
              No Image
            </span>
          </div>
        )}
        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <PlayCircle className="w-12 h-12 text-white drop-shadow-lg" />
        </div>
        <div className="absolute bottom-2 right-2 px-2 py-1 bg-black/80 text-white text-xs font-medium rounded backdrop-blur-sm">
          {formatTime(item.currentTime)}
        </div>

        {/* Progress Bar */}
        <div className="absolute bottom-0 left-0 right-0 h-1 bg-zinc-800">
          <div
            className="h-full bg-indigo-500"
            style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
          />
        </div>
      </div>

      <div className="mt-3 px-1 z-20 relative">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-white font-medium line-clamp-1 flex-1 group-hover:text-indigo-400 transition-colors">
            {item.video.vod_name}
          </h3>
          <button
            onClick={(e) => onRemove(e, item.videoId)}
            className="text-zinc-500 hover:text-red-400 p-1 -mr-1 -mt-1 opacity-0 group-hover:opacity-100 transition-opacity relative z-40"
            title="Remove from history"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
        <p className="text-zinc-400 text-sm mt-1 flex items-center gap-2">
          <span className="truncate max-w-30">{item.groupName}</span>
          <span className="w-1 h-1 rounded-full bg-zinc-600"></span>
          <span>Ep {item.episodeIndex + 1}</span>
        </p>
        <p className="text-zinc-500 text-xs mt-3">
          {new Date(item.timestamp).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </p>
      </div>
    </Link>
  );
};

export const History: React.FC = () => {
  const [history, setHistory] = useState<HistoryItem[]>([]);

  useEffect(() => {
    setHistory(getHistory());
  }, []);

  const handleClear = () => {
    if (
      window.confirm(
        "Are you sure you want to clear your entire watch history?",
      )
    ) {
      clearHistory();
      setHistory([]);
    }
  };

  const handleRemove = (e: React.MouseEvent, videoId: number) => {
    e.preventDefault();
    e.stopPropagation();
    removeHistoryItem(videoId);
    setHistory(getHistory());
  };

  const formatTime = (seconds: number) => {
    if (!seconds || isNaN(seconds)) return "0:00";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0)
      return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Clock className="w-8 h-8 text-indigo-500" />
          <h2 className="text-3xl font-bold text-white">Watch History</h2>
        </div>
        {history.length > 0 && (
          <button
            onClick={handleClear}
            className="flex items-center gap-2 text-zinc-400 hover:text-red-400 transition-colors text-sm font-medium"
          >
            <Trash2 className="w-4 h-4" />
            Clear History
          </button>
        )}
      </div>

      {history.length === 0 ? (
        <div className="text-center py-20 bg-zinc-900/30 rounded-2xl border border-zinc-800/50">
          <Clock className="w-12 h-12 text-zinc-600 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-zinc-300">
            No watch history
          </h3>
          <p className="text-zinc-500 mt-2">
            Videos you watch will appear here.
          </p>
          <Link
            to="/"
            className="inline-block mt-6 px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-full font-medium transition-colors"
          >
            Explore Videos
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-6">
          {history.map((item) => (
            <HistoryCard
              key={item.videoId}
              item={item}
              onRemove={handleRemove}
              formatTime={formatTime}
            />
          ))}
        </div>
      )}
    </div>
  );
};
