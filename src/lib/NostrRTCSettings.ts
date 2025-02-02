export const ANNOUNCE_INTERVAL = 10 * 1000;
export const PEER_EXPIRATION = 5 * 60 * 1000;
export const GC_INTERVAL = 60 * 1000;
export const KIND = 29999;
export const CONNECTING_TIMEOUT = 2 * 60 * 1000;
export const P2P_TIMEOUT = 60 * 1000;
export const PUBLIC_STUN_SERVERS = [
    "stun.cloudflare.com:3478",
    "stun.l.google.com:19302",
    "stun.l.google.com:5349",
    "stun1.l.google.com:3478",
    "stun1.l.google.com:5349",
    "stun2.l.google.com:19302",
    "stun2.l.google.com:5349",
    "stun3.l.google.com:3478",
    "stun3.l.google.com:5349",
    "stun4.l.google.com:19302",
    "stun4.l.google.com:5349",
    "stunserver2024.stunprotocol.org:3478",
];

export type NostrRTCSettings = {
    announceInterval: number;
    peerExpiration: number;
    gcInterval: number;
    kind: number;
    connectionAttemptTimeout: number;
    p2pAttemptTimeout: number;
};

export default {
    announceInterval: ANNOUNCE_INTERVAL,
    peerExpiration: PEER_EXPIRATION,
    gcInterval: GC_INTERVAL,
    kind: KIND,
    connectionAttemptTimeout: CONNECTING_TIMEOUT,
    p2pAttemptTimeout: P2P_TIMEOUT,
} as NostrRTCSettings;
