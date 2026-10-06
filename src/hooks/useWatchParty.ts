import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { initPusherClient, isPusherEnabled } from '../config/pusher';
import { useLatest } from '../utils';

/** Which realtime transport ended up being used. */
export type PartyTransport = 'pusher' | 'socketio';

export interface VideoAction {
  action: 'play' | 'pause' | 'seek';
  time: number;
  sourceId?: string;
  groupName?: string;
  playUrl?: string;
  episodeIndex?: number;
}

export interface VideoState {
  id?: string | number;
  sourceId: string;
  groupName: string;
  playUrl: string;
  episodeIndex: number;
  /** Only sent on request, never applied blindly. */
  aggregatedSources?: unknown[];
}

/** How long a remote action suppresses the local echo. */
const REMOTE_ECHO_GUARD_MS = 500;
/** Delay before asking the room for its current state after subscribing. */
const STATE_REQUEST_DELAY_MS = 1000;

export interface UseWatchPartyOptions {
  partyId: string | null;
  videoId: string | undefined;
  /** Current local selection, used to answer state requests. */
  getState: () => Omit<VideoState, 'id' | 'aggregatedSources'>;
  /** Current aggregated sources, used to answer state requests. */
  getAggregatedSources: () => unknown[];
  /** Apply a peer's playback action to the local player + selection. */
  onRemoteAction: (action: VideoAction) => void;
  /** Apply a peer's selection without touching playback. */
  onRemoteSelection: (state: Partial<VideoState>) => void;
  /** Follow the room onto a different video. */
  onRemoteNavigate: (sourceId: string, id: string | number) => void;
}

export interface UseWatchPartyResult {
  transport: PartyTransport | null;
  roomSize: number;
  /** True while a remote action is being applied (suppresses local echo). */
  isRemoteUpdate: React.RefObject<boolean>;
  /** Broadcast a local playback action. No-op outside a party. */
  broadcastAction: (
    action: VideoAction['action'],
    time: number,
    override?: Partial<VideoState>,
  ) => void;
  /** Broadcast the current selection so a peer can adopt it. */
  broadcastState: (state: VideoState) => void;
}

/**
 * Watch-party realtime, transport-agnostic.
 *
 * This previously lived inline in `Player.tsx` with the Pusher and Socket.IO
 * branches each carrying their own full copy of the "apply a remote action"
 * logic and their own copy of the "apply a remote selection" logic. The two
 * copies had already drifted (the Socket.IO one used `episodeIndex || 0`,
 * the Pusher one checked `!== undefined`). Both now share one implementation;
 * only the wire format differs between transports.
 */
export const useWatchParty = (
  options: UseWatchPartyOptions,
): UseWatchPartyResult => {
  const {
    partyId,
    videoId,
    getState,
    getAggregatedSources,
    onRemoteAction,
    onRemoteSelection,
    onRemoteNavigate,
  } = options;

  const [transport, setTransport] = useState<PartyTransport | null>(null);
  const [roomSize, setRoomSize] = useState(1);

  const videoIdRef = useLatest(videoId);
  const getStateRef = useLatest(getState);
  const getSourcesRef = useLatest(getAggregatedSources);
  const onActionRef = useLatest(onRemoteAction);
  const onSelectionRef = useLatest(onRemoteSelection);
  const onNavigateRef = useLatest(onRemoteNavigate);

  const isRemoteUpdate = useRef(false);
  const guardTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasRequestedState = useRef(false);

  const pusherChannel = useRef<{
    bind: (event: string, cb: (...args: unknown[]) => void) => void;
    trigger: (event: string, data: unknown) => void;
    unbind_all: () => void;
  } | null>(null);
  const pusherClient = useRef<{
    unsubscribe: (channel: string) => void;
  } | null>(null);
  const socketRef = useRef<Socket | null>(null);

  const markRemoteUpdate = useCallback(() => {
    isRemoteUpdate.current = true;
    if (guardTimer.current) clearTimeout(guardTimer.current);
    guardTimer.current = setTimeout(() => {
      isRemoteUpdate.current = false;
    }, REMOTE_ECHO_GUARD_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (guardTimer.current) clearTimeout(guardTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!partyId) {
      setTransport(null);
      return;
    }

    let cancelled = false;
    const effectPartyId = partyId;
    let cleanup: (() => void) | null = null;

    const answerStateRequest = () => {
      const state: VideoState = {
        id: videoIdRef.current,
        ...getStateRef.current(),
        aggregatedSources: getSourcesRef.current(),
      };
      pusherChannel.current?.trigger('client-current-video-state', state);
      socketRef.current?.emit('current-video-state', state);
    };

    /**
     * Single implementation of "apply what a peer is playing". Both
     * transports route through this, so they cannot drift.
     */
    const applyRemoteAction = (raw: Partial<VideoAction>) => {
      markRemoteUpdate();
      const selection: Partial<VideoState> = {};
      if (raw.sourceId) selection.sourceId = raw.sourceId;
      if (raw.groupName) selection.groupName = raw.groupName;
      if (raw.playUrl) {
        selection.playUrl = raw.playUrl;
        if (raw.episodeIndex !== undefined) {
          selection.episodeIndex = raw.episodeIndex;
        }
      }
      onSelectionRef.current(selection);
      onActionRef.current({
        action: raw.action ?? 'play',
        time: raw.time ?? 0,
      });
    };

    const applyRemoteState = (raw: Partial<VideoState> & { id?: unknown }) => {
      const selection: Partial<VideoState> = {};
      if (raw.sourceId) selection.sourceId = raw.sourceId;
      if (raw.groupName) selection.groupName = raw.groupName;
      if (raw.playUrl) {
        selection.playUrl = raw.playUrl;
        if (raw.episodeIndex !== undefined) {
          selection.episodeIndex = raw.episodeIndex;
        }
      }
      onSelectionRef.current(selection);

      if (raw.id != null && String(raw.id) !== videoIdRef.current) {
        if (raw.sourceId) onNavigateRef.current(raw.sourceId, String(raw.id));
        return;
      }
      // Same video: adopt their aggregated sources if we have none yet.
      if (raw.aggregatedSources?.length) {
        onSelectionRef.current({
          aggregatedSources: raw.aggregatedSources,
        } as Partial<VideoState>);
      }
    };

    const requestState = () => {
      setTimeout(() => {
        if (cancelled) return;
        try {
          pusherChannel.current?.trigger('client-request-video-state', {});
          socketRef.current?.emit('request-video-state', {});
        } catch (err) {
          console.error('[Party] Request state error:', err);
        }
      }, STATE_REQUEST_DELAY_MS);
    };

    void (async () => {
      const client = await initPusherClient();
      if (cancelled || client) {
        pusherClient.current = client as unknown as {
          unsubscribe: (channel: string) => void;
        } | null;
      }
      if (cancelled) return;

      const pusherEnabled = client ? await isPusherEnabled() : false;

      if (client && pusherEnabled) {
        const channelName = `private-party-${effectPartyId}`;
        const channel = client.subscribe(channelName);
        pusherChannel.current =
          channel as unknown as typeof pusherChannel.current;

        channel.bind('client-request-video-state', answerStateRequest);
        channel.bind('client-video-action', (data: unknown) =>
          applyRemoteAction(data as Partial<VideoAction>),
        );
        channel.bind('client-current-video-state', (data: unknown) =>
          applyRemoteState(data as Partial<VideoState> & { id?: unknown }),
        );
        channel.bind('pusher:subscription_succeeded', () => {
          setRoomSize((prev) => prev + 1);
          hasRequestedState.current = true;
          requestState();
        });

        setTransport('pusher');
        cleanup = () => {
          channel.unbind_all();
          client.unsubscribe(channelName);
        };
        return;
      }

      // === Socket.IO fallback (Pusher not configured) ===
      const socket = io();
      socketRef.current = socket;
      socket.emit('join-room', effectPartyId);
      socket.on('room-size', (size: number) => setRoomSize(size));
      socket.on('current-video-state', (data) =>
        applyRemoteState(data as Partial<VideoState> & { id?: unknown }),
      );
      socket.on('video-action', (data) =>
        applyRemoteAction(data as Partial<VideoAction>),
      );

      setTransport('socketio');
      requestState();

      cleanup = () => {
        socket.close();
        socketRef.current = null;
      };
    })();

    return () => {
      cancelled = true;
      pusherChannel.current = null;
      cleanup?.();
      setTransport(null);
      setRoomSize(1);
      hasRequestedState.current = false;
    };
  }, [
    partyId,
    markRemoteUpdate,
    onActionRef,
    onNavigateRef,
    onSelectionRef,
    getSourcesRef,
    getStateRef,
    videoIdRef,
  ]);

  const broadcastAction = useCallback(
    (
      action: VideoAction['action'],
      time: number,
      override?: Partial<VideoState>,
    ) => {
      if (!partyId || isRemoteUpdate.current) return;
      const payload: VideoAction = {
        action,
        time,
        ...getStateRef.current(),
        ...override,
      };
      socketRef.current?.emit('video-action', {
        roomId: partyId,
        ...payload,
      });
      pusherChannel.current?.trigger('client-video-action', payload);
    },
    [partyId, getStateRef],
  );

  const broadcastState = useCallback((state: VideoState) => {
    pusherChannel.current?.trigger('client-current-video-state', state);
    socketRef.current?.emit('current-video-state', state);
  }, []);

  return {
    transport,
    roomSize,
    isRemoteUpdate,
    broadcastAction,
    broadcastState,
  };
};
