import { ChevronLeft, ChevronRight, Loader2, UsersRound } from "lucide-react";
import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { io } from "socket.io-client";
import { VideoCard } from "../components/VideoCard";
import {
  fetchCategories,
  fetchVideos,
  getPrimarySource,
} from "../services/api";
import { getHiddenCategories } from "../services/preferences";
import { Category, Video } from "../types";
import { isTauri } from "../utils";

export const Home: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const categoryParam = searchParams.get("category");
  const partyParam = searchParams.get("party");
  const activeCategory = categoryParam
    ? parseInt(categoryParam, 10)
    : undefined;

  const [videos, setVideos] = useState<Video[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [hiddenCategories, setHiddenCategories] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);

  const [prevCategory, setPrevCategory] = useState(activeCategory);
  const [socket, setSocket] = useState<any>(null);
  const [joinPartyInput, setJoinPartyInput] = useState("");
  const [roomSize, setRoomSize] = useState(1);

  if (activeCategory !== prevCategory) {
    setPrevCategory(activeCategory);
    setPage(1);
    setVideos([]);
  }

  useEffect(() => {
    if (partyParam) {
      if (isTauri()) {
        (async () => {
          const { initPusherClient, isPusherEnabled } =
            await import("../config/pusher");
          const client = await initPusherClient();
          const enabled = await isPusherEnabled();
          if (enabled && client) {
            const channel = client.subscribe(`private-party-${partyParam}`);
            channel.bind("client-current-video-state", (data: any) => {
              console.log("[Home] Received current-video-state:", data);
              if (data.sourceId && data.id) {
                navigate(
                  `/video/${data.sourceId}/${data.id}?party=${partyParam}`,
                );
              }
            });
            channel.bind("pusher:subscription_succeeded", () => {
              console.log("[Home] Subscribed, requesting current state");
              setTimeout(() => {
                try {
                  channel.trigger("client-request-video-state", {});
                } catch (e) {
                  console.error("[Home] Request state error:", e);
                }
              }, 1000);
            });
            setSocket(channel);
          }
        })();
      } else {
        const newSocket = io();
        setSocket(newSocket as any);

        newSocket.emit("join-room", partyParam);

        newSocket.on("room-size", (size: number) => {
          setRoomSize(size);
        });

        newSocket.on("current-video-state", (data: any) => {
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
      setJoinPartyInput("");
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

  const primarySourceId = getPrimarySource()?.id;

  useEffect(() => {
    const loadCategories = async () => {
      try {
        const res = await fetchCategories();
        if (res.class) {
          setCategories(res.class);
        }
      } catch (error) {
        // console.error("Failed to load categories", error);
      }
    };
    loadCategories();
    if (primarySourceId) {
      getHiddenCategories(primarySourceId).then(setHiddenCategories);
    }
  }, [primarySourceId]);

  useEffect(() => {
    const loadVideos = async () => {
      setLoading(true);
      try {
        const res = await fetchVideos(page, activeCategory);
        if (res.list) {
          if (page === 1) {
            setVideos(res.list);
          } else {
            setVideos((prev) => [...prev, ...res.list]);
          }
          setHasMore(page < res.pagecount);
        }
      } catch (error) {
        // console.error("Failed to load videos", error);
      } finally {
        setLoading(false);
      }
    };
    loadVideos();
  }, [page, activeCategory, primarySourceId]);

  const handleCategoryChange = (
    id?: number,
    event?: React.MouseEvent<HTMLButtonElement>,
  ) => {
    if (id === undefined) {
      searchParams.delete("category");
    } else {
      searchParams.set("category", id.toString());
    }
    setSearchParams(searchParams);

    if (event && event.currentTarget) {
      event.currentTarget.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "center",
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
    window.addEventListener("resize", checkScroll);
    return () => window.removeEventListener("resize", checkScroll);
  }, [categories]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      if (e.deltaY !== 0) {
        e.preventDefault();
        container.scrollBy({
          left: e.deltaY > 0 ? 300 : -300,
          behavior: "smooth",
        });
      }
    };

    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => container.removeEventListener("wheel", handleWheel);
  }, []);

  const scroll = (direction: "left" | "right") => {
    if (scrollContainerRef.current) {
      const scrollAmount = scrollContainerRef.current.clientWidth * 0.8;
      scrollContainerRef.current.scrollBy({
        left: direction === "left" ? -scrollAmount : scrollAmount,
        behavior: "smooth",
      });
    }
  };

  return (
    <div className="space-y-8">
      {/* Watch Party */}
      {partyParam && socket ? (
        <div className="flex items-center justify-between bg-indigo-500/10 border border-indigo-500/30 px-4 py-3 rounded-lg">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-indigo-400 text-sm font-medium">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500"></span>
              </span>
              {isTauri() ? `Party: ${partyParam}` : "Watch Party Active"}
            </div>
            <div className="w-px h-4 bg-indigo-500/30"></div>
            <div className="flex items-center gap-1.5 text-zinc-300 text-sm">
              <UsersRound className="w-4 h-4" />
              <span>{roomSize} watching</span>
            </div>
          </div>
          <button
            onClick={handleLeaveParty}
            className="text-zinc-400 hover:text-white text-sm"
          >
            Leave Party
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2 justify-end">
          <input
            type="text"
            placeholder="Enter party code"
            value={joinPartyInput}
            onChange={(e) => setJoinPartyInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleJoinParty()}
            className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm w-40 focus:border-indigo-500 focus:outline-none"
          />
          <button
            onClick={handleJoinParty}
            disabled={!joinPartyInput.trim()}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            <UsersRound className="w-4 h-4" />
            Join
          </button>
        </div>
      )}

      {/* Categories */}
      <div className="relative group">
        {canScrollLeft && (
          <div className="absolute left-0 top-0 bottom-2 w-16 bg-linear-to-r from-zinc-950 to-transparent z-10 flex items-center justify-start pointer-events-none">
            <button
              onClick={() => scroll("left")}
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
            onClick={(e) => handleCategoryChange(undefined, e)}
            className={`whitespace-nowrap cursor-pointer px-4 py-2 rounded-full text-sm font-medium transition-colors shrink-0 ${
              activeCategory === undefined
                ? "bg-indigo-500 text-white"
                : "bg-zinc-900 text-zinc-400 hover:bg-zinc-800 hover:text-white"
            }`}
          >
            All
          </button>
          {categories
            .filter((cat) => !hiddenCategories.includes(cat.type_id))
            .map((cat) => (
              <button
                key={cat.type_id}
                onClick={(e) => handleCategoryChange(cat.type_id, e)}
                className={`whitespace-nowrap px-4 py-2 rounded-full cursor-pointer text-sm font-medium transition-colors shrink-0 ${
                  activeCategory === cat.type_id
                    ? "bg-indigo-500 text-white"
                    : "bg-zinc-900 text-zinc-400 hover:bg-zinc-800 hover:text-white"
                }`}
              >
                {cat.type_name}
              </button>
            ))}
        </div>

        {canScrollRight && (
          <div className="absolute right-0 top-0 bottom-2 w-16 bg-linear-to-l from-zinc-950 to-transparent z-10 flex items-center justify-end pointer-events-none">
            <button
              onClick={() => scroll("right")}
              className="cursor-pointer p-1.5 rounded-full bg-zinc-800/80 text-white hover:bg-zinc-700 backdrop-blur-sm pointer-events-auto shadow-lg mr-1"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        )}
      </div>

      {/* Video Grid */}
      {videos.length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 sm:gap-6">
          {videos.map((video) => (
            <VideoCard
              key={`${video.vod_id}-${page}`}
              video={video}
              sourceId={primarySourceId}
            />
          ))}
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
            onClick={() => setPage((p) => p + 1)}
            className="cursor-pointer px-6 py-3 bg-zinc-900 hover:bg-zinc-800 text-white rounded-full font-medium transition-colors"
          >
            Load More
          </button>
        </div>
      )}
    </div>
  );
};
