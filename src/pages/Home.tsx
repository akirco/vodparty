import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import React, { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { VideoCard } from "../components/VideoCard";
import {
  fetchCategories,
  fetchVideos,
  getPrimarySource,
} from "../services/api";
import { getHiddenCategories } from "../services/preferences";
import { Category, Video } from "../types";

export const Home: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const categoryParam = searchParams.get("category");
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

  // Reset page and videos when category changes via URL (e.g., browser back button)
  if (activeCategory !== prevCategory) {
    setPrevCategory(activeCategory);
    setPage(1);
    setVideos([]);
  }

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const primarySource = getPrimarySource();

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
    setHiddenCategories(getHiddenCategories());
  }, []);

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
  }, [page, activeCategory]);

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
      {/* Categories */}
      <div className="relative group">
        {canScrollLeft && (
          <div className="absolute left-0 top-0 bottom-2 w-16 bg-linear-to-r from-zinc-950 to-transparent z-10 flex items-center justify-start pointer-events-none">
            <button
              onClick={() => scroll("left")}
              className="p-1.5 rounded-full bg-zinc-800/80 text-white hover:bg-zinc-700 backdrop-blur-sm pointer-events-auto shadow-lg ml-1"
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
            className={`whitespace-nowrap px-4 py-2 rounded-full text-sm font-medium transition-colors shrink-0 ${
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
                className={`whitespace-nowrap px-4 py-2 rounded-full text-sm font-medium transition-colors shrink-0 ${
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
              className="p-1.5 rounded-full bg-zinc-800/80 text-white hover:bg-zinc-700 backdrop-blur-sm pointer-events-auto shadow-lg mr-1"
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
              sourceId={primarySource.id}
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
            className="px-6 py-3 bg-zinc-900 hover:bg-zinc-800 text-white rounded-full font-medium transition-colors"
          >
            Load More
          </button>
        </div>
      )}
    </div>
  );
};
