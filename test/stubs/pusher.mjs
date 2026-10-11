// Minimal stub for pusher-js used by tests.
export default class Pusher {
  constructor(_key, _options) {}
  subscribe(_channel) {
    return {
      bind: () => {},
      unbind: () => {},
      unsubscribe: () => {},
    };
  }
  unsubscribe(_channel) {}
  disconnect() {}
}
