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
} from "lucide-react";
import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { io, Socket } from "socket.io-client";
import { HlsPlayer } from "../components/HlsPlayer";
import { initPusherClient, isPusherEnabled } from "../config/pusher";
import { fetchVideoDetails, fetchVideos, getSources } from "../services/api";
import { getHistory, saveHistoryItem } from "../services/history";
import { isTauri } from "../utils";
import { ApiSource, PlayUrl, Video } from "../types";

interface PlayGroup {
  groupName: string;
  urls: PlayUrl[];
}

interface AggregatedSource {
  apiSource: ApiSource;
  video: Video;
  playGroups: PlayGroup[];
}

interface VideoAction {
  roomId?: string;
  action: string;
  time: number;
  sourceId?: string;
  groupName?: string;
  playUrl?: string;
  episodeIndex?: number;
}

const parsePlayUrls = (
  playUrlStr: string,
  playFromStr: string,
): PlayGroup[] => {
  if (!playUrlStr) return [];
  const groups = playUrlStr.split("$$$");
  const froms = (playFromStr || "").split("$$$");

  return groups
    .map((group, index) => {
      const groupName = froms[index] || `Source ${index + 1}`;
      const urls = group
        .split("#")
        .filter(Boolean)
        .map((ep, epIndex) => {
          const parts = ep.split("$");
          if (parts.length >= 2) {
            return { name: parts[0] || `Ep ${epIndex + 1}`, url: parts[1] };
          }
          return { name: `Ep ${epIndex + 1}`, url: ep };
        })
        .filter((ep) => ep.url.toLowerCase().includes(".m3u8"));
      return { groupName, urls };
    })
    .filter((g) => g.urls.length > 0);
};

export const Player: React.FC = () => {
  const { sourceId, id } = useParams<{ sourceId: string; id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const partyId = searchParams.get("party");

  const [loading, setLoading] = useState(true);
  const [aggregatedSources, setAggregatedSources] = useState<
    AggregatedSource[]
  >([]);

  const [activeSourceId, setActiveSourceId] = useState<string>("");
  const [activeGroupName, setActiveGroupName] = useState<string>("");
  const [currentPlayUrl, setCurrentPlayUrl] = useState<string>("");
  const [activeEpisode, setActiveEpisode] = useState<number>(0);
  const [initialTime, setInitialTime] = useState<number>(0);
  const [reverseEpisodes, setReverseEpisodes] = useState(false);

  // Watch Party State
  const [socket, setSocket] = useState<Socket | null>(null);
  const [roomSize, setRoomSize] = useState(1);
  const [copied, setCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [isCssFullscreen, setIsCssFullscreen] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const isRemoteUpdate = useRef(false);
  const lastSaveTime = useRef(0);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pusherChannel = useRef<any>(null);
  const pusherClientRef = useRef<any>(null);

  useEffect(() => {
    if (partyId) {
      const newSocket = io();
      setSocket(newSocket);

      newSocket.emit("join-room", partyId);

      newSocket.on("room-size", (size: number) => {
        setRoomSize(size);
      });

      newSocket.on("current-video-state", (data: any) => {
        if (data.sourceId && data.sourceId !== activeSourceId) {
          setActiveSourceId(data.sourceId);
        }
        if (data.groupName && data.groupName !== activeGroupName) {
          setActiveGroupName(data.groupName);
        }
        if (data.playUrl && data.playUrl !== currentPlayUrl) {
          setCurrentPlayUrl(data.playUrl);
          setActiveEpisode(data.episodeIndex || 0);
        }
        if (data.id && id !== data.id.toString()) {
          navigate(`/video/${data.sourceId}/${data.id}${searchParams.toString()}`);
        }
      });

      newSocket.on("video-action", (data) => {
        if (!videoRef.current) return;

        // Sync source/episode if changed remotely
        if (data.sourceId && data.sourceId !== activeSourceId) {
          setActiveSourceId(data.sourceId);
        }
        if (data.groupName && data.groupName !== activeGroupName) {
          setActiveGroupName(data.groupName);
        }
        if (data.playUrl && data.playUrl !== currentPlayUrl) {
          setCurrentPlayUrl(data.playUrl);
          setActiveEpisode(data.episodeIndex);
        }

        isRemoteUpdate.current = true;

        if (data.action === "play") {
          if (Math.abs(videoRef.current.currentTime - data.time) > 2) {
            videoRef.current.currentTime = data.time;
          }
          videoRef.current.play().catch(console.error);
        } else if (data.action === "pause") {
          videoRef.current.currentTime = data.time;
          videoRef.current.pause();
        } else if (data.action === "seek") {
          videoRef.current.currentTime = data.time;
        }

        setTimeout(() => {
          isRemoteUpdate.current = false;
        }, 500);
      });

      // Initialize Pusher client
      initPusherClient().then(async (client) => {
        pusherClientRef.current = client;
        
        if (client) {
          const pusherEnabled = await isPusherEnabled();
          if (pusherEnabled) {
            console.log("[Pusher] Connecting to private-party-" + partyId);
            pusherChannel.current = client.subscribe(
              `private-party-${partyId}`,
            );

            

            pusherChannel.current.bind(
              "client-request-video-state",
              () => {
                console.log("[Pusher] Received request-video-state, broadcasting current state");
                const videoState = {
                  id: id,
                  sourceId: activeSourceId,
                  playUrl: currentPlayUrl,
                  groupName: activeGroupName,
                  episodeIndex: activeEpisode,
                };
                try {
                  pusherChannel.current.trigger("client-current-video-state", videoState);
                } catch (err) {
                  console.error("[Pusher] Trigger current-video-state error:", err);
                }
              }
            );

            pusherChannel.current.bind(
              "client-video-action",
              (data: VideoAction) => {
                console.log("[Pusher] Received video-action:", data);
                if (!videoRef.current) return;

                if (data.sourceId && data.sourceId !== activeSourceId) {
                  setActiveSourceId(data.sourceId);
                }
                if (data.groupName && data.groupName !== activeGroupName) {
                  setActiveGroupName(data.groupName);
                }
                if (data.playUrl && data.playUrl !== currentPlayUrl) {
                  setCurrentPlayUrl(data.playUrl);
                  if (data.episodeIndex !== undefined) {
                    setActiveEpisode(data.episodeIndex);
                  }
                }

                isRemoteUpdate.current = true;

                if (data.action === "play") {
                  if (Math.abs(videoRef.current.currentTime - data.time) > 2) {
                    videoRef.current.currentTime = data.time;
                  }
                  videoRef.current.play().catch(console.error);
                } else if (data.action === "pause") {
                  videoRef.current.currentTime = data.time;
                  videoRef.current.pause();
                } else if (data.action === "seek") {
                  videoRef.current.currentTime = data.time;
                }

                setTimeout(() => {
                  isRemoteUpdate.current = false;
                }, 500);
              },
            );

            pusherChannel.current.bind("pusher:subscription_succeeded", () => {
              setRoomSize((prev: number) => prev + 1);
            });
          }
        }
      });

      return () => {
        newSocket.close();
        if (pusherChannel.current) {
          pusherChannel.current.unbind_all();
          pusherClientRef.current?.unsubscribe(`private-party-${partyId}`);
        }
      };
    }
  }, [partyId, activeSourceId, activeGroupName, currentPlayUrl]);

  const emitVideoAction = (action: string) => {
    if (!isRemoteUpdate.current && partyId && videoRef.current) {
      const videoActionData: VideoAction = {
        action,
        time: videoRef.current.currentTime,
        sourceId: activeSourceId,
        groupName: activeGroupName,
        playUrl: currentPlayUrl,
        episodeIndex: activeEpisode,
      };

      // Socket.IO for development
      if (socket) {
        socket.emit("video-action", {
          roomId: partyId,
          ...videoActionData,
        });
      }

      // Pusher for production
      isPusherEnabled().then((pusherEnabled) => {
        console.log(
          "[Pusher] emit - enabled:",
          pusherEnabled,
          "channel:",
          !!pusherChannel.current,
          "partyId:",
          partyId,
        );
        if (pusherEnabled && pusherChannel.current) {
          try {
            console.log(
              "[Pusher] Triggering client-video-action:",
              videoActionData,
            );
            pusherChannel.current.trigger("client-video-action", videoActionData);
          } catch (err) {
            console.error("[Pusher] Trigger error:", err);
          }
        }
      });
    }
  };

const handleCreateParty = () => {
    const newPartyId = Math.random().toString(36).substring(2, 9);
    setSearchParams({ party: newPartyId });
  };

  const broadcastVideoState = () => {
    if (!partyId || !pusherChannel.current) return;
    const videoState = {
      id: id,
      sourceId: activeSourceId,
      playUrl: currentPlayUrl,
      groupName: activeGroupName,
      episodeIndex: activeEpisode,
    };
    console.log("[Pusher] Broadcasting video state:", videoState);
    try {
      pusherChannel.current.trigger("client-current-video-state", videoState);
    } catch (err) {
      console.error("[Pusher] Broadcast error:", err);
    }
  };

  const copyPartyLink = () => {
    if (isTauri()) {
      navigator.clipboard.writeText(partyId || "");
    } else {
      navigator.clipboard.writeText(window.location.href);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const copyVideoLink = () => {
    if (isTauri()) {
      navigator.clipboard.writeText(currentPlayUrl);
    } else {
      navigator.clipboard.writeText(currentPlayUrl);
    }
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  };

  useEffect(() => {
    const loadVideo = async () => {
      if (!id || !sourceId) return;
      setLoading(true);
      try {
        const primaryApiSource = getSources().find((s) => s.id === sourceId);
        if (!primaryApiSource) throw new Error("Source not found");

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
          const historyItem = history.find((h) => h.videoId === data.vod_id);

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

          const otherSources = getSources().filter((s) => s.id !== sourceId);
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
        console.error("Failed to load video details", error);
      } finally {
        setLoading(false);
      }
    };
    loadVideo();
  }, [id, sourceId]);

  useEffect(() => {
    if (!loading && partyId && currentPlayUrl) {
      isPusherEnabled().then((enabled) => {
        if (enabled) {
          setTimeout(broadcastVideoState, 500);
        }
      });
    }
  }, [loading, partyId, currentPlayUrl]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isCssFullscreen) {
        setIsCssFullscreen(false);
      }
      if (e.key === "f" || e.key === "F") {
        if (
          document.activeElement?.tagName !== "INPUT" &&
          document.activeElement?.tagName !== "TEXTAREA"
        ) {
          setIsCssFullscreen((prev: boolean) => !prev);
        }
      }
    };

    if (isCssFullscreen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isCssFullscreen]);

  const handleTimeUpdate = async () => {
    if (!videoRef.current || !activeAggSource) return;
    const currentTime = videoRef.current.currentTime;
    const duration = videoRef.current.duration;

    if (
      currentTime - lastSaveTime.current > 5 ||
      currentTime < lastSaveTime.current
    ) {
      await saveHistoryItem({
        videoId: activeAggSource.video.vod_id,
        video: activeAggSource.video,
        sourceId: activeSourceId,
        groupName: activeGroupName,
        playUrl: currentPlayUrl,
        episodeIndex: activeEpisode,
        currentTime,
        duration: isNaN(duration) ? 0 : duration,
        timestamp: Date.now(),
      });
      lastSaveTime.current = currentTime;
    }
  };

  const handleEnded = () => {
    if (!activeGroup) return;
    const nextIndex = activeEpisode + 1;
    if (nextIndex < activeGroup.urls.length) {
      const nextEp = activeGroup.urls[nextIndex];
      setCurrentPlayUrl(nextEp.url);
      setActiveEpisode(nextIndex);
      setInitialTime(0);
      if (socket && partyId) {
        socket.emit("video-action", {
          roomId: partyId,
          action: "play",
          time: 0,
          sourceId: activeSourceId,
          groupName: activeGroupName,
          playUrl: nextEp.url,
          episodeIndex: nextIndex,
        });
      }
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[60vh]">
        <Loader2 className="w-10 h-10 animate-spin text-indigo-500" />
      </div>
    );
  }

  if (aggregatedSources.length === 0) {
    return (
      <div className="text-center py-20">
        <h2 className="text-2xl font-bold text-zinc-400">Video not found</h2>
        <button
          onClick={() => navigate(-1)}
          className="mt-4 text-indigo-500 hover:underline"
        >
          Go back
        </button>
      </div>
    );
  }

  const activeAggSource =
    aggregatedSources.find((s) => s.apiSource.id === activeSourceId) ||
    aggregatedSources[0];
  const video = activeAggSource.video;
  const activeGroup =
    activeAggSource.playGroups.find((g) => g.groupName === activeGroupName) ||
    activeAggSource.playGroups[0];

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <div className="flex items-center justify-end gap-3">
        {currentPlayUrl && (
          <button
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
              {isTauri() ? `Party: ${partyId}` : "Watch Party Active"}
            </div>
            <div className="w-px h-4 bg-indigo-500/30 mx-1"></div>
            <div className="flex items-center gap-1.5 text-zinc-300 text-sm">
              <Users className="w-4 h-4" />
              <span>{roomSize} watching</span>
            </div>
            <div className="w-px h-4 bg-indigo-500/30 mx-1"></div>
            <button
              onClick={copyPartyLink}
              className="flex items-center gap-1.5 text-indigo-400 hover:text-indigo-300 text-sm font-medium transition-colors"
            >
              {copied ? (
                <Check className="w-4 h-4" />
              ) : (
                <Copy className="w-4 h-4" />
              )}
              {copied ? "Copied!" : isTauri() ? "Copy Code" : "Copy Link"}
            </button>
          </div>
        ) : partyId ? (
          <div className="flex items-center gap-2 text-indigo-400 text-sm">
            <UsersRound className="w-4 h-4" />
            Hosting Party: {partyId}
          </div>
        ) : (
          <button
            onClick={handleCreateParty}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            <UsersRound className="w-4 h-4" />
            Start Watch Party
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Player Section */}
        <div className="lg:col-span-2 space-y-4">
          <div
            className={`group ${
              isCssFullscreen
                ? "fixed inset-0 z-100 w-screen h-screen bg-black flex items-center justify-center"
                : "relative aspect-video bg-black rounded-xl overflow-hidden shadow-xl"
            }`}
          >
            {currentPlayUrl ? (
              <HlsPlayer
                src={currentPlayUrl}
                poster={video.vod_pic}
                initialTime={initialTime}
                videoRef={videoRef}
                onPlay={() => emitVideoAction("play")}
                onPause={() => emitVideoAction("pause")}
                onSeeked={() => emitVideoAction("seek")}
                onTimeUpdate={handleTimeUpdate}
                onEnded={handleEnded}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-zinc-500">
                No playable source found
              </div>
            )}

            {/* CSS Fullscreen Toggle Button */}
            <button
              onClick={() => setIsCssFullscreen(!isCssFullscreen)}
              className="absolute top-4 right-4 p-2 bg-black/50 hover:bg-black/80 text-white rounded-lg backdrop-blur-sm transition-all z-50 opacity-100 md:opacity-0 md:group-hover:opacity-100"
              title={
                isCssFullscreen ? "Exit Page Fullscreen" : "Page Fullscreen"
              }
            >
              {isCssFullscreen ? (
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
                <Calendar className="w-4 h-4" /> {video.vod_year || "Unknown"}
              </span>
              <span className="flex items-center gap-1">
                <MapPin className="w-4 h-4" /> {video.vod_area || "Unknown"}
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

          <div className="bg-zinc-900/50 rounded-xl p-6 border border-zinc-800/50">
            <h3 className="text-lg font-semibold mb-2 text-white">Synopsis</h3>
            <div
              className="text-zinc-300 text-sm leading-relaxed max-w-none [&>p]:mb-4"
              dangerouslySetInnerHTML={{
                __html: video.vod_content || "No synopsis available.",
              }}
            />
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
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
                    key={src.apiSource.id}
                    onClick={() => {
                      setActiveSourceId(src.apiSource.id);
                      const firstGroup = src.playGroups[0];
                      if (firstGroup) {
                        setActiveGroupName(firstGroup.groupName);
                        if (firstGroup.urls.length > 0) {
                          setCurrentPlayUrl(firstGroup.urls[0].url);
                          setActiveEpisode(0);
                          if (socket && partyId) {
                            socket.emit("video-action", {
                              roomId: partyId,
                              action: "play",
                              time: 0,
                              sourceId: src.apiSource.id,
                              groupName: firstGroup.groupName,
                              playUrl: firstGroup.urls[0].url,
                              episodeIndex: 0,
                            });
                          }
                        }
                      }
                    }}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                      activeSourceId === src.apiSource.id
                        ? "bg-indigo-600 text-white shadow-lg shadow-indigo-500/20"
                        : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white"
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
                    key={group.groupName}
                    onClick={() => {
                      setActiveGroupName(group.groupName);
                      if (group.urls.length > 0) {
                        setCurrentPlayUrl(group.urls[0].url);
                        setActiveEpisode(0);
                        if (socket && partyId) {
                          socket.emit("video-action", {
                            roomId: partyId,
                            action: "play",
                            time: 0,
                            sourceId: activeSourceId,
                            groupName: group.groupName,
                            playUrl: group.urls[0].url,
                            episodeIndex: 0,
                          });
                        }
                      }
                    }}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                      activeGroupName === group.groupName
                        ? "bg-zinc-200 text-zinc-900"
                        : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white"
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
                  onClick={() => setReverseEpisodes(!reverseEpisodes)}
                  className={`p-2 rounded-lg text-sm font-medium transition-colors ${
                    reverseEpisodes
                      ? "bg-indigo-600 text-white"
                      : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white"
                  }`}
                  title={reverseEpisodes ? "Normal order" : "Reverse order"}
                >
                  <ArrowDownUp className="w-4 h-4" />
                </button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-2 gap-2 max-h-100 overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-zinc-700 scrollbar-track-transparent">
                {(reverseEpisodes
                  ? [...activeGroup.urls].reverse()
                  : activeGroup.urls
                ).map((ep, index) => (
                  <button
                    key={index}
                    onClick={() => {
                      setCurrentPlayUrl(ep.url);
                      setActiveEpisode(index);
                      if (socket && partyId) {
                        socket.emit("video-action", {
                          roomId: partyId,
                          action: "play",
                          time: 0,
                          sourceId: activeSourceId,
                          groupName: activeGroupName,
                          playUrl: ep.url,
                          episodeIndex: index,
                        });
                      }
                    }}
                    className={`px-3 py-2 rounded-lg text-sm font-medium transition-all text-left truncate ${
                      activeEpisode === index && currentPlayUrl === ep.url
                        ? "bg-indigo-600 text-white shadow-lg shadow-indigo-500/20"
                        : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-white"
                    }`}
                    title={ep.name}
                  >
                    {ep.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Details */}
          <div className="bg-zinc-900/50 rounded-xl p-6 border border-zinc-800/50 space-y-4">
            <h3 className="text-lg font-semibold text-white">Details</h3>
            {video.vod_director && (
              <div>
                <span className="text-zinc-500 text-sm block mb-1">
                  Director
                </span>
                <span className="text-zinc-200 text-sm">
                  {video.vod_director}
                </span>
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
        </div>
      </div>
    </div>
  );
};
