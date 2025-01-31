export const ANNOUNCE_INTERVAL = 10 * 1000;
export const PEER_EXPIRATION = 5 * 60 * 1000;
export const GC_INTERVAL = 60 * 1000;
export const KIND = 29999;
export const CONNECTING_TIMEOUT = 2*60*1000;
export const STUN_SERVERS = [
 
];

export type NostrRTCSettings = {
    ANNOUNCE_INTERVAL: number;
    PEER_EXPIRATION: number;
    GC_INTERVAL: number;
    KIND: number;
    CONNECTING_TIMEOUT: number;
    STUN_SERVERS: string[];
};

export default {
    ANNOUNCE_INTERVAL,
    PEER_EXPIRATION,
    GC_INTERVAL,
    KIND,
    CONNECTING_TIMEOUT,
    STUN_SERVERS
} as NostrRTCSettings;
