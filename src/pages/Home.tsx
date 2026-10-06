import { ChevronLeft, ChevronRight, Loader2, UsersRound } from 'lucide-react';
import type React from 'react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { io } from 'socket.io-client';
import { VideoCard } from '../components/VideoCard';
// Static import: the route is already code-split, so a dynamic import here
// only triggered INEFFECTIVE_DYNAMIC_IMPORT without chunking anything.
import { initPusherClient, isPusherEnabled } from '../config/pusher';
import {
  clearPersistedCategoryCaches,
  fetchCategories,
  fetchEmptyCategoryIds,
  fetchVideos,
} from '../services/api';
import { getHiddenCategories } from '../services/preferences';
import { homeScrollPosition, useHomeStore } from '../stores/useHomeStore';
import { useSourceStore } from '../stores/useSourceStore';
import type { Category } from '../types';
import { isTauri } from '../utils';

export const Home: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const categoryParam = searchParams.get('category');
  const partyParam = searchParams.get('party');
  const activeCategory = categoryParam
    ? parseInt(categoryParam, 10)
    : undefined;

  // Subscribe per-field: `useHomeStore()` with no selector subscribes to the
  // whole store, so any state change re-rendered every VideoCard in the grid.
  const videos = useHomeStore((s) => s.videos);
  const page = useHomeStore((s) => s.page);
  const loading = useHomeStore((s) => s.loading);
  const hasMore = useHomeStore((s) => s.hasMore);
  const [categories, setCategories] = useState<Category[]>([]);
  const [hiddenCategories, setHiddenCategories] = useState<number[]>([]);
  const [socket, setSocket] = useState<any>(null);
  const [joinPartyInput, setJoinPartyInput] = useState('');
  const [roomSize, setRoomSize] = useState(1);

  // Categories confirmed to be EMPTY are hidden. Starts empty and fills in
  // progressively as probing resolves, so every category is visible (and
  // clickable) immediately instead of the tab bar showing only "Checking…".
  const [emptyCategoryIds, setEmptyCategoryIds] = useState<Set<number>>(
    new Set(),
  );
  const [checkingCategories, setCheckingCategories] = useState(false);
  const probedSourceRef = useRef<string | null>(null);
  const probeNonceRef = useRef(0);

  // Detect category change and reset store accordingly
  const prevCategoryRef = useRef(activeCategory);
  useEffect(() => {
    if (prevCategoryRef.current !== activeCategory) {
      prevCategoryRef.current = activeCategory;
      // A new category is a fresh list: don't restore the previous offset.
      homeScrollPosition.current = 0;
      useHomeStore.getState().reset();
    }
  }, [activeCategory]);

  // Track scroll position continuously
  useEffect(() => {
    const handleScroll = () => {
      homeScrollPosition.current = window.scrollY;
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Restore scroll position before first paint
  useLayoutEffect(() => {
    if (homeScrollPosition.current > 0) {
      window.scrollTo(0, homeScrollPosition.current);
    }
  }, []);

  useEffect(() => {
    if (partyParam) {
      if (isTauri()) {
        (async () => {
          const client = await initPusherClient();
          const enabled = await isPusherEnabled();
          if (enabled && client) {
            const channel = client.subscribe(`private-party-${partyParam}`);
            channel.bind('client-current-video-state', (data: any) => {
              if (data.sourceId && data.id) {
                navigate(
                  `/video/${data.sourceId}/${data.id}?party=${partyParam}`,
                );
              }
            });
            channel.bind('pusher:subscription_succeeded', () => {
              setTimeout(() => {
                try {
                  channel.trigger('client-request-video-state', {});
                } catch (e) {
                  console.error('[Home] Request state error:', e);
                }
              }, 1000);
            });
            setSocket(channel);
          }
        })();
      } else {
        const newSocket = io();
        setSocket(newSocket as any);

        newSocket.emit('join-room', partyParam);

        newSocket.on('room-size', (size: number) => {
          setRoomSize(size);
        });

        newSocket.on('current-video-state', (data: any) => {
          if (data.sourceId && data.id) {
            navigate(`/video/${data.sourceId}/${data.id}?party=${partyParam}`);
          }
        });

        return () => {
          newSocket.disconnect();
        };
      }
    }
  }, [partyParam, navigate]);

  const handleJoinParty = () => {
    if (joinPartyInput.trim()) {
      setSearchParams({ party: joinPartyInput.trim() });
      setJoinPartyInput('');
    }
  };

  const handleLeaveParty = () => {
    if (socket) {
      if (isTauri()) {
        socket.unsubscribe(`private-party-${partyParam}`);
      } else {
        socket.disconnect();
      }
    }
    setSearchParams({});
    setSocket(null);
    setRoomSize(1);
  };

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const primarySourceId = useSourceStore(
    (s) =>
      (s.sources.find((src) => src.id === s.primarySourceId) || s.sources[0])
        ?.id,
  );

  useEffect(() => {
    const loadCategories = async () => {
      try {
        const res = await fetchCategories();
        if (res.class) {
          setCategories(res.class);
        }
      } catch {}
    };
    loadCategories();
    if (primarySourceId) {
      getHiddenCategories(primarySourceId).then(setHiddenCategories);
    }
  }, [primarySourceId]);

  // Probe categories and hide the empty ones (some Apple CMS parents have no
  // videos of their own). Results are cached 24h by the api layer.
  useEffect(() => {
    if (categories.length === 0 || !primarySourceId) return;
    if (probedSourceRef.current === primarySourceId) return;
    probedSourceRef.current = primarySourceId;
    // Bumping the nonce orphans any in-flight manual re-probe.
    probeNonceRef.current += 1;
    let cancelled = false;
    setEmptyCategoryIds(new Set());
    setCheckingCategories(true);

    fetchEmptyCategoryIds(categories, primarySourceId, (typeId, hasVideos) => {
      if (cancelled) return;
      setEmptyCategoryIds((prev) => {
        // Unknown result (probe failed) keeps the tab visible.
        if (hasVideos) {
          if (!prev.has(typeId)) {
            const next = new Set(prev);
            next.delete(typeId);
            return next;
          }
          return prev;
        }
        if (prev.has(typeId)) return prev;
        const next = new Set(prev);
        next.add(typeId);
        return next;
      });
    })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setCheckingCategories(false);
      });

    return () => {
      cancelled = true;
    };
  }, [categories, primarySourceId]);

  // Manual re-probe: drop the persisted 24h probe result and run again.
  const handleRecheckCategories = async () => {
    if (!primarySourceId || categories.length === 0) return;
    const nonce = ++probeNonceRef.current;
    setEmptyCategoryIds(new Set());
    setCheckingCategories(true);
    try {
      await clearPersistedCategoryCaches();
      const fresh = await fetchCategories(primarySourceId);
      const list = fresh.class ?? categories;
      setCategories(list);
      await fetchEmptyCategoryIds(
        list,
        primarySourceId,
        (typeId, hasVideos) => {
          if (probeNonceRef.current !== nonce) return;
          setEmptyCategoryIds((prev) => {
            const next = new Set(prev);
            if (hasVideos) next.delete(typeId);
            else next.add(typeId);
            return next;
          });
        },
      );
    } catch {
    } finally {
      if (probeNonceRef.current === nonce) setCheckingCategories(false);
    }
  };

  // Fetch page 1 on mount or category change
  useEffect(() => {
    if (videos.length > 0) return;
    const loadVideos = async () => {
      useHomeStore.getState().setLoading(true);
      try {
        const res = await fetchVideos(1, activeCategory);
        if (res.list) {
          const s = useHomeStore.getState();
          s.setVideos(res.list);
          s.setPage(1);
          s.setHasMore(1 < res.pagecount);
        }
      } catch {
      } finally {
        useHomeStore.getState().setLoading(false);
      }
    };
    loadVideos();
  }, [activeCategory, primarySourceId, videos.length]);

  const handleLoadMore = async () => {
    const nextPage = page + 1;
    useHomeStore.getState().setLoading(true);
    try {
      const res = await fetchVideos(nextPage, activeCategory);
      if (res.list) {
        const s = useHomeStore.getState();
        s.appendVideos(res.list);
        s.setPage(nextPage);
        s.setHasMore(nextPage < res.pagecount);
      }
    } catch {
    } finally {
      useHomeStore.getState().setLoading(false);
    }
  };

  const handleCategoryChange = (
    id?: number,
    event?: React.MouseEvent<HTMLButtonElement>,
  ) => {
    // Build a new params object instead of mutating the one `useSearchParams`
    // handed back: mutating it in place mutates the router's current state.
    const next = new URLSearchParams(searchParams);
    if (id === undefined) {
      next.delete('category');
    } else {
      next.set('category', id.toString());
    }
    setSearchParams(next);

    if (event?.currentTarget) {
      event.currentTarget.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'center',
      });
    }
  };

  const checkScroll = () => {
    if (scrollContainerRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } =
        scrollContainerRef.current;
      setCanScrollLeft(scrollLeft > 0);
      setCanScrollRight(Math.ceil(scrollLeft + clientWidth) < scrollWidth);
    }
  };

  useEffect(() => {
    checkScroll();
    window.addEventListener('resize', checkScroll);
    return () => window.removeEventListener('resize', checkScroll);
  }, [categories]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      if (e.deltaY !== 0) {
        e.preventDefault();
        container.scrollBy({
          left: e.deltaY > 0 ? 300 : -300,
          behavior: 'smooth',
        });
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, []);

  const scroll = (direction: 'left' | 'right') => {
    if (scrollContainerRef.current) {
      const scrollAmount = scrollContainerRef.current.clientWidth * 0.8;
      scrollContainerRef.current.scrollBy({
        left: direction === 'left' ? -scrollAmount : scrollAmount,
        behavior: 'smooth',
      });
    }
  };

  return (
    <div>
      {/* Watch Party */}
      {partyParam && socket ? (
        <div className="flex items-center justify-between bg-indigo-500/10 border border-indigo-500/30 px-4 py-3 rounded-lg mb-8">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-indigo-400 text-sm font-medium">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500"></span>
              </span>
              {isTauri() ? `Party: ${partyParam}` : 'Watch Party Active'}
            </div>
            <div className="w-px h-4 bg-indigo-500/30"></div>
            <div className="flex items-center gap-1.5 text-zinc-300 text-sm">
              <UsersRound className="w-4 h-4" />
              <span>{roomSize} watching</span>
            </div>
          </div>
          <button
            type="button"
            onClick={handleLeaveParty}
            className="text-zinc-400 hover:text-white text-sm"
          >
            Leave Party
          </button>
        </div>
      ) : isTauri() ? (
        <div className="flex items-center gap-2 justify-end mb-8">
          <input
            type="text"
            placeholder="Enter party code"
            value={joinPartyInput}
            onChange={(e) => setJoinPartyInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleJoinParty()}
            className="bg-zinc-900 border border-zinc-700/50 rounded-lg px-3 py-2 text-white text-sm w-50 focus:border-indigo-500 focus:outline-none"
          />
          <button
            type="button"
            onClick={handleJoinParty}
            disabled={!joinPartyInput.trim()}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            <UsersRound className="w-4 h-4" />
            Join
          </button>
        </div>
      ) : null}

      {/* Categories (sticky below header) */}
      <div className="sticky top-16 z-40 bg-zinc-950/80 backdrop-blur-md border-b border-zinc-800/50 -mx-2 sm:-mx-4 lg:-mx-6 px-2 sm:px-4 lg:px-6 py-2 mb-8">
        {canScrollLeft && (
          <div className="absolute left-0 top-0 bottom-2 w-16 bg-linear-to-r from-zinc-950 to-transparent z-10 flex items-center justify-start pointer-events-none">
            <button
              type="button"
              onClick={() => scroll('left')}
              className="cursor-pointer p-1.5 rounded-full bg-zinc-800/80 text-white hover:bg-zinc-700 backdrop-blur-sm pointer-events-auto shadow-lg ml-1"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
          </div>
        )}

        <div
          ref={scrollContainerRef}
          onScroll={checkScroll}
          className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide scroll-smooth relative px-1"
        >
          <button
            type="button"
            onClick={(e) => handleCategoryChange(undefined, e)}
            className={`whitespace-nowrap cursor-pointer px-4 py-2 rounded-full text-sm font-medium transition-colors shrink-0 ${
              activeCategory === undefined
                ? 'bg-indigo-500 text-white'
                : 'bg-zinc-900 text-zinc-400 hover:bg-zinc-800 hover:text-white'
            }`}
          >
            All
          </button>
          {categories
            .filter(
              (cat) =>
                !hiddenCategories.includes(cat.type_id) &&
                !emptyCategoryIds.has(cat.type_id),
            )
            .map((cat) => (
              <button
                type="button"
                key={cat.type_id}
                onClick={(e) => handleCategoryChange(cat.type_id, e)}
                className={`whitespace-nowrap px-4 py-2 rounded-full cursor-pointer text-sm font-medium transition-colors shrink-0 ${
                  activeCategory === cat.type_id
                    ? 'bg-indigo-500 text-white'
                    : 'bg-zinc-900 text-zinc-400 hover:bg-zinc-800 hover:text-white'
                }`}
              >
                {cat.type_name}
              </button>
            ))}
          {checkingCategories ? (
            <span className="whitespace-nowrap px-4 py-2 rounded-full text-sm font-medium text-zinc-500 bg-zinc-900 shrink-0 flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Checking…
            </span>
          ) : (
            <button
              type="button"
              onClick={handleRecheckCategories}
              className="whitespace-nowrap px-4 py-2 rounded-full text-sm font-medium text-zinc-500 bg-zinc-900 hover:bg-zinc-800 hover:text-zinc-300 shrink-0 transition-colors"
              title="Re-check which categories have videos"
            >
              Re-check
            </button>
          )}
        </div>

        {canScrollRight && (
          <div className="absolute right-0 top-0 bottom-2 w-16 bg-linear-to-l from-zinc-950 to-transparent z-10 flex items-center justify-end pointer-events-none">
            <button
              type="button"
              onClick={() => scroll('right')}
              className="cursor-pointer p-1.5 rounded-full bg-zinc-800/80 text-white hover:bg-zinc-700 backdrop-blur-sm pointer-events-auto shadow-lg mr-1"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        )}
      </div>

      {/* Video Grid. Long scroll pages are windowed via content-visibility so
          hundreds of accumulated cards skip layout/paint work off-screen
          without any JS measurement. */}
      {videos.length > 0 ? (
        <div
          style={{
            contentVisibility: 'auto',
            containIntrinsicSize: 'auto 420px',
          }}
        >
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 sm:gap-6">
            {videos.map((video) => (
              <VideoCard
                key={video.vod_id}
                video={video}
                sourceId={primarySourceId}
              />
            ))}
          </div>
        </div>
      ) : !loading ? (
        <div className="text-center py-20 text-zinc-500">
          No videos found. Please check your API settings.
        </div>
      ) : null}

      {/* Loading & Load More */}
      {loading && (
        <div className="flex justify-center py-8">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
        </div>
      )}
      {!loading && hasMore && videos.length > 0 && (
        <div className="flex justify-center py-8">
          <button
            type="button"
            onClick={handleLoadMore}
            className="cursor-pointer px-6 py-3 bg-zinc-900 hover:bg-zinc-800 text-white rounded-full font-medium transition-colors"
          >
            Load More
          </button>
        </div>
      )}
    </div>
  );
};
