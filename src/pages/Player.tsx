import {
  ArrowDownUp,
  Calendar,
  Check,
  Copy,
  Film,
  Link,
  Loader2,
  MapPin,
  Maximize,
  Minimize,
  PlayCircle,
  Server,
  Users,
  UsersRound,
} from 'lucide-react';
import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { EpisodeGrid } from '../components/EpisodeGrid';
import { usePlayerHost } from '../components/PlayerHost';
import type { VideoAction, VideoState } from '../hooks/useWatchParty';
import { useWatchParty } from '../hooks/useWatchParty';
import {
  ensureSourcesLoaded,
  fetchVideoDetails,
  fetchVideos,
} from '../services/api';
import { getHistory } from '../services/history';
import { useSourceStore } from '../stores/useSourceStore';
import type { ApiSource, PlayUrl, Video } from '../types';
import { isTauri } from '../utils';
import { sanitizeHtml } from '../utils/sanitizeHtml';

interface PlayGroup {
  groupName: string;
  urls: PlayUrl[];
}

interface AggregatedSource {
  apiSource: ApiSource;
  video: Video;
  playGroups: PlayGroup[];
}

const parsePlayUrls = (
  playUrlStr: string,
  playFromStr: string,
): PlayGroup[] => {
  if (!playUrlStr) return [];
  const groups = playUrlStr.split('$$$');
  const froms = (playFromStr || '').split('$$$');

  return groups
    .map((group, index) => {
      const groupName = froms[index] || `Source ${index + 1}`;
      const urls = group
        .split('#')
        .filter(Boolean)
        .map((ep, epIndex) => {
          const parts = ep.split('$');
          if (parts.length >= 2) {
            return { name: parts[0] || `Ep ${epIndex + 1}`, url: parts[1] };
          }
          return { name: `Ep ${epIndex + 1}`, url: ep };
        })
        .filter((ep) => ep.url.toLowerCase().includes('.m3u8'));
      return { groupName, urls };
    })
    .filter((g) => g.urls.length > 0);
};

export const Player: React.FC = () => {
  const { sourceId, id } = useParams<{ sourceId: string; id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const partyId = searchParams.get('party');

  const [loading, setLoading] = useState(true);
  const [aggregatedSources, setAggregatedSources] = useState<
    AggregatedSource[]
  >([]);

  const [activeSourceId, setActiveSourceId] = useState<string>('');
  const [activeGroupName, setActiveGroupName] = useState<string>('');
  const [currentPlayUrl, setCurrentPlayUrl] = useState<string>('');
  const [activeEpisode, setActiveEpisode] = useState<number>(0);
  const [initialTime, setInitialTime] = useState<number>(0);
  const [reverseEpisodes, setReverseEpisodes] = useState(false);

  const [copied, setCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  // The <video> element now lives in PlayerHost (above the router), so
  // navigating away keeps playing. This page drives it and lends it a surface.
  const host = usePlayerHost();
  const {
    attachSurface,
    setSource,
    setSession,
    setOnEnded,
    setOnPlaybackEvent,
    getVideo,
    seek,
  } = host;

  /**
   * Callback ref, not a useEffect: this page renders a spinner first, so the
   * surface element only appears once loading finishes. An effect would run
   * once on mount (surface still null), never re-run, and leave the host
   * thinking it is off-page -- which showed the mini player on top of the
   * full player.
   */
  const setSurface = useCallback(
    (el: HTMLDivElement | null) => {
      attachSurface(el);
    },
    [attachSurface],
  );

  /** Adopt a selection coming from a peer (source / line / episode). */
  const applySelection = useCallback(
    (next: Partial<VideoState>) => {
      if (next.sourceId) setActiveSourceId(next.sourceId);
      if (next.groupName) setActiveGroupName(next.groupName);
      if (next.playUrl) {
        setCurrentPlayUrl(next.playUrl);
        setLoading(false);
        // A different stream means the saved position no longer applies.
        setInitialTime(0);
      }
      if (next.episodeIndex !== undefined) setActiveEpisode(next.episodeIndex);
      if (next.aggregatedSources?.length && aggregatedSources.length === 0) {
        setAggregatedSources(next.aggregatedSources as AggregatedSource[]);
      }
    },
    [aggregatedSources.length],
  );

  /**
   * Drive the local <video> element to match a peer's playback action.
   * Wire-level decoding lives in the hook; this is only the element.
   */
  const driveLocalPlayback = useCallback(
    ({ action, time }: VideoAction) => {
      const video = getVideo();
      if (!video) return;
      if (action === 'play') {
        // Avoid a pointless seek when we are already within tolerance.
        if (Math.abs(video.currentTime - time) > 2) video.currentTime = time;
        void video.play().catch(console.error);
      } else if (action === 'pause') {
        video.currentTime = time;
        video.pause();
      } else if (action === 'seek') {
        video.currentTime = time;
      }
    },
    [getVideo],
  );

  const currentSelection = useCallback(
    () => ({
      sourceId: activeSourceId,
      groupName: activeGroupName,
      playUrl: currentPlayUrl,
      episodeIndex: activeEpisode,
    }),
    [activeSourceId, activeGroupName, currentPlayUrl, activeEpisode],
  );

  const { roomSize, isRemoteUpdate, broadcastAction, broadcastState } =
    useWatchParty({
      partyId,
      videoId: id,
      getState: currentSelection,
      getAggregatedSources: () => aggregatedSources,
      onRemoteAction: driveLocalPlayback,
      onRemoteSelection: applySelection,
      onRemoteNavigate: useCallback(
        (remoteSourceId: string, remoteId: string | number) => {
          navigate(
            `/video/${remoteSourceId}/${String(remoteId)}?party=${partyId ?? ''}`,
          );
        },
        [navigate, partyId],
      ),
    });

  /**
   * Single entry point for changing what is playing. Every control (episode
   * grid, line selector, source selector, auto-advance, keyboard shortcuts)
   * used to repeat the same setState block plus its own copy of the party
   * broadcast.
   */
  const playEpisode = useCallback(
    (next: {
      sourceId?: string;
      groupName?: string;
      episodeIndex: number;
      url: string;
      broadcast?: boolean;
    }) => {
      const nextSourceId = next.sourceId ?? activeSourceId;
      const nextGroupName = next.groupName ?? activeGroupName;

      setActiveSourceId(nextSourceId);
      setActiveGroupName(nextGroupName);
      setCurrentPlayUrl(next.url);
      setActiveEpisode(next.episodeIndex);
      setInitialTime(0);

      // A deliberate local switch should tell the room, unless we are the ones
      // reacting to a remote action.
      if (next.broadcast !== false && !isRemoteUpdate.current) {
        broadcastAction('play', 0, {
          sourceId: nextSourceId,
          groupName: nextGroupName,
          playUrl: next.url,
          episodeIndex: next.episodeIndex,
        });
      }
    },
    [activeSourceId, activeGroupName, isRemoteUpdate, broadcastAction],
  );

  const emitVideoAction = useCallback(
    (action: VideoAction['action']) => {
      const video = getVideo();
      if (!video) return;
      broadcastAction(action, video.currentTime);
    },
    [getVideo, broadcastAction],
  );

  const handleCreateParty = () => {
    const newPartyId = Math.random().toString(36).substring(2, 9);
    setSearchParams({ party: newPartyId });
  };

  const broadcastVideoState = useCallback(() => {
    broadcastState({
      id,
      ...currentSelection(),
      aggregatedSources,
    });
  }, [broadcastState, id, currentSelection, aggregatedSources]);

  const copyPartyLink = () => {
    if (isTauri()) {
      navigator.clipboard.writeText(partyId || '');
    } else {
      navigator.clipboard.writeText(window.location.href);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const copyVideoLink = () => {
    navigator.clipboard.writeText(currentPlayUrl);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  };

  useEffect(() => {
    const loadVideo = async () => {
      if (!id || !sourceId) return;
      setLoading(true);
      try {
        await ensureSourcesLoaded();
        const primaryApiSource = useSourceStore
          .getState()
          .sources.find((s) => s.id === sourceId);
        if (!primaryApiSource) throw new Error('Source not found');

        const data = await fetchVideoDetails(parseInt(id, 10), sourceId);
        if (data) {
          const groups = parsePlayUrls(data.vod_play_url, data.vod_play_from);

          const initialSource: AggregatedSource = {
            apiSource: primaryApiSource,
            video: data,
            playGroups: groups,
          };

          setAggregatedSources([initialSource]);

          const history = await getHistory();
          // Match on source too: `vod_id` is only unique within a source, so
          // two different CMS backends routinely reuse the same id.
          const historyItem = history.find(
            (h) => h.videoId === data.vod_id && h.sourceId === sourceId,
          );

          if (historyItem) {
            setActiveSourceId(historyItem.sourceId);
            setActiveGroupName(historyItem.groupName);
            setCurrentPlayUrl(historyItem.playUrl);
            setActiveEpisode(historyItem.episodeIndex);
            setInitialTime(historyItem.currentTime);
          } else {
            setActiveSourceId(primaryApiSource.id);
            if (groups.length > 0) {
              setActiveGroupName(groups[0].groupName);
              if (groups[0].urls.length > 0) {
                setCurrentPlayUrl(groups[0].urls[0].url);
                setActiveEpisode(0);
              }
            }
          }

          const otherSources = useSourceStore
            .getState()
            .sources.filter((s) => s.id !== sourceId);
          otherSources.forEach(async (otherSource) => {
            try {
              const searchRes = await fetchVideos(
                1,
                undefined,
                data.vod_name,
                otherSource.id,
              );
              if (searchRes.list) {
                const match = searchRes.list.find(
                  (v) => v.vod_name === data.vod_name,
                );
                if (match) {
                  const otherGroups = parsePlayUrls(
                    match.vod_play_url,
                    match.vod_play_from,
                  );
                  if (otherGroups.length > 0) {
                    setAggregatedSources((prev: AggregatedSource[]) => {
                      if (prev.some((s) => s.apiSource.id === otherSource.id))
                        return prev;
                      return [
                        ...prev,
                        {
                          apiSource: otherSource,
                          video: match,
                          playGroups: otherGroups,
                        },
                      ];
                    });
                  }
                }
              }
            } catch (e) {
              console.error(`Failed to search in ${otherSource.name}`, e);
            }
          });
        }
      } catch (error) {
        console.error('Failed to load video details', error);
      } finally {
        setLoading(false);
      }
    };
    loadVideo();
  }, [id, sourceId]);

  useEffect(() => {
    if (loading || !partyId || !currentPlayUrl) return;
    // Let the player settle before announcing what we are watching.
    const timer = setTimeout(broadcastVideoState, 500);
    return () => clearTimeout(timer);
  }, [loading, partyId, currentPlayUrl, broadcastVideoState]);

  useEffect(() => {
    const switchEpisode = (direction: -1 | 1) => {
      const aggSource =
        aggregatedSources.find((s) => s.apiSource.id === activeSourceId) ||
        aggregatedSources[0];
      const group =
        aggSource?.playGroups.find((g) => g.groupName === activeGroupName) ||
        aggSource?.playGroups[0];
      if (!group) return;
      const newIndex = activeEpisode + direction;
      if (newIndex < 0 || newIndex >= group.urls.length) return;

      playEpisode({
        sourceId: activeSourceId,
        groupName: activeGroupName,
        episodeIndex: newIndex,
        url: group.urls[newIndex].url,
      });
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      // `f` / fullscreen moved to PlayerHost so it keeps working while the
      // video plays on in the mini bar. Only the episode shortcuts, which
      // need this page's episode list, stay here.
      if (e.ctrlKey && (e.key === ',' || e.key === '<')) {
        e.preventDefault();
        switchEpisode(-1);
      }
      if (e.ctrlKey && (e.key === '.' || e.key === '>')) {
        e.preventDefault();
        switchEpisode(1);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [
    aggregatedSources,
    activeSourceId,
    activeGroupName,
    activeEpisode,
    playEpisode,
  ]);

  const activeAggSource =
    aggregatedSources.find((s) => s.apiSource.id === activeSourceId) ||
    aggregatedSources[0];
  const videoMeta = activeAggSource?.video;
  const activeGroup =
    activeAggSource?.playGroups.find((g) => g.groupName === activeGroupName) ||
    activeAggSource?.playGroups[0];

  const handleEnded = useCallback(() => {
    if (!activeGroup) return;
    const nextIndex = activeEpisode + 1;
    if (nextIndex < activeGroup.urls.length) {
      playEpisode({
        sourceId: activeSourceId,
        groupName: activeGroupName,
        episodeIndex: nextIndex,
        url: activeGroup.urls[nextIndex].url,
      });
    }
  }, [
    activeGroup,
    activeEpisode,
    playEpisode,
    activeSourceId,
    activeGroupName,
  ]);

  // Hand the stream to the host. Kept above the early returns so the player is
  // driven even while this page is still loading.
  useEffect(() => {
    if (!currentPlayUrl) return;
    setSource(currentPlayUrl, videoMeta?.vod_pic ?? '', initialTime);
  }, [currentPlayUrl, videoMeta?.vod_pic, initialTime, setSource]);

  // Metadata for the mini bar and for history. The host retains it after this
  // page unmounts, which is what lets progress keep being recorded.
  useEffect(() => {
    if (!videoMeta || !currentPlayUrl) {
      setSession(null);
      return;
    }
    setSession({
      videoId: videoMeta.vod_id,
      videoName: videoMeta.vod_name,
      videoPic: videoMeta.vod_pic,
      sourceId: activeSourceId,
      groupName: activeGroupName,
      playUrl: currentPlayUrl,
      episodeIndex: activeEpisode,
    });
  }, [
    videoMeta,
    currentPlayUrl,
    activeSourceId,
    activeGroupName,
    activeEpisode,
    setSession,
  ]);

  // Auto-advance belongs to the page; clear it when navigating away so the
  // mini player does not try to walk an episode list it cannot see.
  useEffect(() => {
    setOnEnded(handleEnded);
    return () => setOnEnded(null);
  }, [handleEnded, setOnEnded]);

  // Forward real playback events to the watch party. Routing this through the
  // host (rather than the page's <video>) means pausing from the mini bar also
  // pauses everyone else.
  useEffect(() => {
    setOnPlaybackEvent(emitVideoAction);
    return () => setOnPlaybackEvent(null);
  }, [emitVideoAction, setOnPlaybackEvent]);

  // Resume position once metadata arrives.
  useEffect(() => {
    if (initialTime > 0 && getVideo()?.readyState) seek(initialTime);
  }, [getVideo, seek, initialTime]);

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[60vh]">
        <Loader2 className="w-10 h-10 animate-spin text-indigo-500" />
      </div>
    );
  }

  if (aggregatedSources.length === 0 || !videoMeta || !activeAggSource) {
    return (
      <div className="text-center py-20">
        <h2 className="text-2xl font-bold text-zinc-400">Video not found</h2>
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="mt-4 text-indigo-500 hover:underline"
        >
          Go back
        </button>
      </div>
    );
  }

  const video = videoMeta;

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <div className="flex items-center justify-end gap-3">
        {currentPlayUrl && (
          <button
            type="button"
            onClick={copyVideoLink}
            className="flex items-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            {linkCopied ? (
              <>
                <Check className="w-4 h-4" /> Copied
              </>
            ) : (
              <>
                <Link className="w-4 h-4" /> Copy Link
              </>
            )}
          </button>
        )}
        {partyId ? (
          <div className="flex items-center gap-3 bg-indigo-500/10 border border-indigo-500/30 px-4 py-2 rounded-full">
            <div className="flex items-center gap-2 text-indigo-400 text-sm font-medium">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500"></span>
              </span>
              {isTauri() ? `Party: ${partyId}` : 'Watch Party Active'}
            </div>
            <div className="w-px h-4 bg-indigo-500/30 mx-1"></div>
            <div className="flex items-center gap-1.5 text-zinc-300 text-sm">
              <Users className="w-4 h-4" />
              <span>{roomSize} watching</span>
            </div>
            <div className="w-px h-4 bg-indigo-500/30 mx-1"></div>
            <button
              type="button"
              onClick={copyPartyLink}
              className="flex items-center gap-1.5 text-indigo-400 hover:text-indigo-300 text-sm font-medium transition-colors"
            >
              {copied ? (
                <Check className="w-4 h-4" />
              ) : (
                <Copy className="w-4 h-4" />
              )}
              {copied ? 'Copied!' : isTauri() ? 'Copy Code' : 'Copy Link'}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={handleCreateParty}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            <UsersRound className="w-4 h-4" />
            Start Watch Party
          </button>
        )}
      </div>

      {/*
        Player (full width). The <video> itself is owned by PlayerHost and is
        re-parented into this surface, so navigating away does not stop
        playback -- it just moves the same element into the mini bar.
        Fullscreen is applied by the host to that element, not by this wrapper.
      */}
      <div className="group relative aspect-video overflow-hidden rounded-xl bg-black shadow-xl">
        {currentPlayUrl ? (
          <div ref={setSurface} className="h-full w-full" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-zinc-500">
            No playable source found
          </div>
        )}

        <button
          type="button"
          onClick={host.toggleFullscreen}
          className="absolute top-4 right-4 p-2 bg-black/50 hover:bg-black/80 text-white rounded-lg backdrop-blur-sm transition-all z-50 opacity-100 md:opacity-0 md:group-hover:opacity-100"
          title={host.isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          aria-label={host.isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
        >
          {host.isFullscreen ? (
            <Minimize className="w-5 h-5" />
          ) : (
            <Maximize className="w-5 h-5" />
          )}
        </button>
      </div>

      <div>
        <h1 className="text-3xl font-bold text-white">{video.vod_name}</h1>
        <div className="flex flex-wrap items-center gap-4 mt-3 text-sm text-zinc-400">
          <span className="flex items-center gap-1">
            <Calendar className="w-4 h-4" /> {video.vod_year || 'Unknown'}
          </span>
          <span className="flex items-center gap-1">
            <MapPin className="w-4 h-4" /> {video.vod_area || 'Unknown'}
          </span>
          <span className="flex items-center gap-1">
            <Film className="w-4 h-4" /> {video.type_name}
          </span>
          {video.vod_remarks && (
            <span className="px-2 py-0.5 bg-indigo-500/20 text-indigo-400 rounded text-xs font-medium">
              {video.vod_remarks}
            </span>
          )}
        </div>
      </div>

      {/* API Sources Selector */}
      {aggregatedSources.length > 1 && (
        <div className="bg-zinc-900/50 rounded-xl p-6 border border-zinc-800/50">
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2 text-zinc-400 uppercase tracking-wider">
            <Server className="w-4 h-4" />
            API Sources
          </h3>
          <div className="flex flex-wrap gap-2">
            {aggregatedSources.map((src) => (
              <button
                type="button"
                key={src.apiSource.id}
                onClick={() => {
                  const firstGroup = src.playGroups[0];
                  if (!firstGroup || firstGroup.urls.length === 0) return;
                  playEpisode({
                    sourceId: src.apiSource.id,
                    groupName: firstGroup.groupName,
                    episodeIndex: 0,
                    url: firstGroup.urls[0].url,
                  });
                }}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                  activeSourceId === src.apiSource.id
                    ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/20'
                    : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white'
                }`}
              >
                {src.apiSource.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Play Groups (Lines) Selector */}
      {activeAggSource && activeAggSource.playGroups.length > 1 && (
        <div className="bg-zinc-900/50 rounded-xl p-6 border border-zinc-800/50">
          <h3 className="text-sm font-semibold mb-3 text-zinc-400 uppercase tracking-wider">
            Play Lines
          </h3>
          <div className="flex flex-wrap gap-2">
            {activeAggSource.playGroups.map((group) => (
              <button
                type="button"
                key={group.groupName}
                onClick={() => {
                  if (group.urls.length === 0) return;
                  playEpisode({
                    sourceId: activeSourceId,
                    groupName: group.groupName,
                    episodeIndex: 0,
                    url: group.urls[0].url,
                  });
                }}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                  activeGroupName === group.groupName
                    ? 'bg-zinc-200 text-zinc-900'
                    : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white'
                }`}
              >
                {group.groupName}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Episodes List */}
      {activeGroup && activeGroup.urls.length > 0 && (
        <div className="bg-zinc-900/50 rounded-xl p-6 border border-zinc-800/50">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold flex items-center gap-2 text-white">
              <PlayCircle className="w-5 h-5 text-indigo-500" />
              Episodes ({activeGroup.urls.length})
            </h3>
            <button
              type="button"
              onClick={() => setReverseEpisodes(!reverseEpisodes)}
              className={`p-2 rounded-lg text-sm font-medium transition-colors ${
                reverseEpisodes
                  ? 'bg-indigo-600 text-white'
                  : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white'
              }`}
              title={reverseEpisodes ? 'Normal order' : 'Reverse order'}
            >
              <ArrowDownUp className="w-4 h-4" />
            </button>
          </div>
          <EpisodeGrid
            urls={activeGroup.urls}
            reversed={reverseEpisodes}
            activeIndex={activeEpisode}
            activeUrl={currentPlayUrl}
            onSelect={(originalIndex) => {
              const ep = activeGroup.urls[originalIndex];
              if (!ep) return;
              playEpisode({
                sourceId: activeSourceId,
                groupName: activeGroupName,
                episodeIndex: originalIndex,
                url: ep.url,
              });
            }}
          />
        </div>
      )}

      {/* Details */}
      <div className="bg-zinc-900/50 rounded-xl p-6 border border-zinc-800/50 space-y-4 select-text">
        <h3 className="text-lg font-semibold text-white">Details</h3>
        {video.vod_director && (
          <div>
            <span className="text-zinc-500 text-sm block mb-1">Director</span>
            <span className="text-zinc-200 text-sm">{video.vod_director}</span>
          </div>
        )}
        {video.vod_actor && (
          <div>
            <span className="text-zinc-500 text-sm block mb-1">Cast</span>
            <span className="text-zinc-200 text-sm leading-relaxed">
              {video.vod_actor}
            </span>
          </div>
        )}
      </div>

      {/* Synopsis */}
      <div className="bg-zinc-900/50 rounded-xl p-6 border border-zinc-800/50">
        <h3 className="text-lg font-semibold mb-2 text-white">Synopsis</h3>
        <div
          className="text-zinc-300 text-sm leading-relaxed max-w-none select-text [&>p]:mb-4"
          dangerouslySetInnerHTML={{
            __html: sanitizeHtml(video.vod_content || 'No synopsis available.'),
          }}
        />
      </div>
    </div>
  );
};
