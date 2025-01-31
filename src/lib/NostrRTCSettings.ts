export const ANNOUNCE_INTERVAL = 10 * 1000;
export const PEER_EXPIRATION = 5 * 60 * 1000;
export const GC_INTERVAL = 60 * 1000;
export const KIND = 29999;
export const CONNECTING_TIMEOUT = 60000;

export type NostrRTCSettings = {
    ANNOUNCE_INTERVAL: number;
    PEER_EXPIRATION: number;
    GC_INTERVAL: number;
    KIND: number;
    CONNECTING_TIMEOUT: number;
};

export default {
    ANNOUNCE_INTERVAL,
    PEER_EXPIRATION,
    GC_INTERVAL,
    KIND,
    CONNECTING_TIMEOUT,
} as NostrRTCSettings;
