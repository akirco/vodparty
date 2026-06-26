import { ArrowRight, Search, X } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SearchModal: React.FC<SearchModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [query, setQuery] = useState('');
  const [mounted, setMounted] = useState(false);
  const [show, setShow] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (isOpen) {
      setMounted(true);
      requestAnimationFrame(() => setShow(true));
    } else {
      setShow(false);
      const timer = setTimeout(() => {
        setMounted(false);
        setQuery('');
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  useEffect(() => {
    if (show && inputRef.current) {
      inputRef.current.focus();
    }
  }, [show]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = query.trim();
      if (trimmed) {
        navigate(`/search?q=${encodeURIComponent(trimmed)}`);
        onClose();
      }
    },
    [query, navigate, onClose],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose],
  );

  if (!mounted) return null;

  return (
    <div
      className={`fixed inset-0 z-9999 flex items-start justify-center pt-[20vh] sm:pt-[25vh] transition-all duration-200 ${
        show ? 'bg-black/60 backdrop-blur-sm' : 'bg-transparent'
      }`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`w-full max-w-xl mx-4 transition-all duration-200 ${
          show
            ? 'opacity-100 translate-y-0 scale-100'
            : 'opacity-0 -translate-y-6 scale-95'
        }`}
      >
        <div className="bg-zinc-900/95 border border-zinc-800/80 rounded-2xl shadow-2xl drop-shadow-2xl shadow-black/50 overflow-hidden backdrop-blur-lg">
          <form onSubmit={handleSubmit}>
            <div className="flex items-center gap-3 px-5 py-4">
              <Search className="w-5 h-5 text-zinc-400 shrink-0" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Search movies, TV shows..."
                className="flex-1 bg-transparent text-white text-base sm:text-lg placeholder-zinc-500 focus:outline-none"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="p-1 text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
              <button
                type="submit"
                disabled={!query.trim()}
                className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-zinc-800 disabled:text-zinc-500 text-white rounded-lg text-sm font-medium transition-all disabled:cursor-not-allowed"
              >
                <span className="hidden sm:inline">Search</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </form>
          <div className="flex items-center justify-end gap-4 px-5 pb-3 text-xs text-zinc-600">
            <span className="flex items-center gap-1.5">
              <kbd className="px-1.5 py-0.5 bg-zinc-800 rounded text-zinc-400 font-mono text-[11px] leading-none">
                ⏎
              </kbd>
              <span className="text-zinc-600">to search</span>
            </span>
            <span className="flex items-center gap-1.5">
              <kbd className="px-1.5 py-0.5 bg-zinc-800 rounded text-zinc-400 font-mono text-[11px] leading-none">
                Esc
              </kbd>
              <span className="text-zinc-600">close</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
