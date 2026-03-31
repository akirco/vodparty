import Pusher from "pusher-js";

const PUSHER_KEY = import.meta.env.VITE_PUSHER_KEY || "";
const PUSHER_CLUSTER = import.meta.env.VITE_PUSHER_CLUSTER || "ap1";
const PUSHER_AUTH_ENDPOINT = import.meta.env.VITE_PUSHER_AUTH_ENDPOINT || "/.netlify/functions/pusher-auth";

export const pusherClient =
  PUSHER_KEY && PUSHER_CLUSTER
    ? new Pusher(PUSHER_KEY, {
        cluster: PUSHER_CLUSTER,
        authEndpoint: PUSHER_AUTH_ENDPOINT,
      })
    : null;

export const isPusherEnabled = () => !!PUSHER_KEY && !!PUSHER_CLUSTER;