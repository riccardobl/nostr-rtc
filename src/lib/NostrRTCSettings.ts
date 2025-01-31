export const ANNOUNCE_INTERVAL = 10 * 1000;
export const PEER_EXPIRATION = 5 * 60 * 1000;
export const GC_INTERVAL = 60 * 1000;
export const KIND = 29999;
export const CONNECTING_TIMEOUT = 2*60*1000;
export const P2P_TIMEOUT = 60*1000;
export const STUN_SERVERS = [
    "stun:stun.cloudflare.com:3478",
    "stun:stun.l.google.com:19302",
    "stun:stun.l.google.com:5349" ,
    "stun:stun1.l.google.com:3478" ,
    "stun:stun1.l.google.com:5349" ,
    "stun:stun2.l.google.com:19302" ,
    "stun:stun2.l.google.com:5349" ,
    "stun:stun3.l.google.com:3478" ,
    "stun:stun3.l.google.com:5349" ,
    "stun:stun4.l.google.com:19302" ,
    "stun:stun4.l.google.com:5349" ,
    "stun:stunserver2024.stunprotocol.org:3478"
];

export type NostrRTCSettings = {
    ANNOUNCE_INTERVAL: number;
    PEER_EXPIRATION: number;
    GC_INTERVAL: number;
    KIND: number;
    CONNECTING_TIMEOUT: number;
    STUN_SERVERS: string[];
    P2P_TIMEOUT: number;
};

export default {
    ANNOUNCE_INTERVAL,
    PEER_EXPIRATION,
    GC_INTERVAL,
    KIND,
    CONNECTING_TIMEOUT,
    STUN_SERVERS,
    P2P_TIMEOUT
} as NostrRTCSettings;
