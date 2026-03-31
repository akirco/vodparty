import Pusher from "pusher-js";

const PUSHER_KEY = import.meta.env.PUSHER_KEY || "";
const PUSHER_CLUSTER = import.meta.env.PUSHER_CLUSTER || "ap1";
const PUSHER_AUTH_ENDPOINT = "/.netlify/functions/pusher-auth";

console.log("[Pusher] Key:", PUSHER_KEY ? "set" : "missing", "Cluster:", PUSHER_CLUSTER);

export const pusherClient =
  PUSHER_KEY && PUSHER_CLUSTER
    ? new Pusher(PUSHER_KEY, {
        cluster: PUSHER_CLUSTER,
        authEndpoint: PUSHER_AUTH_ENDPOINT,
      })
    : null;

export const isPusherEnabled = () => {
  const enabled = !!PUSHER_KEY && !!PUSHER_CLUSTER;
  console.log("[Pusher] Enabled:", enabled);
  return enabled;
};