import { Loader2 } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { VideoCard } from '../components/VideoCard';
import { fetchVideos } from '../services/api';
import { useSourceStore } from '../stores/useSourceStore';
import { Video } from '../types';

export const Search: React.FC = () => {
  const [searchParams] = useSearchParams();
  const query = searchParams.get('q') || '';
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);

  const primarySourceId = useSourceStore(
    (s) =>
      (s.sources.find((src) => src.id === s.primarySourceId) || s.sources[0])
        ?.id,
  );

  useEffect(() => {
    const loadSearch = async () => {
      if (!query) return;
      setLoading(true);
      try {
        const res = await fetchVideos(1, undefined, query);
        if (res.list) {
          setVideos(res.list);
        } else {
          setVideos([]);
        }
      } catch (error) {
        console.error('Search failed', error);
      } finally {
        setLoading(false);
      }
    };
    loadSearch();
  }, [query, primarySourceId]);

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white">
        Search Results for <span className="text-indigo-500">"{query}"</span>
      </h2>

      {loading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
        </div>
      ) : videos.length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 sm:gap-6">
          {videos.map((video) => (
            <VideoCard
              key={video.vod_id}
              video={video}
              sourceId={primarySourceId}
            />
          ))}
        </div>
      ) : (
        <div className="text-center py-20 text-zinc-500">No results found.</div>
      )}
    </div>
  );
};
