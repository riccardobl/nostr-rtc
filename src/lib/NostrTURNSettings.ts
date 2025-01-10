export const CHUNK_LENGTH = 1024;
export const PACKET_TIMEOUT = 10000;
export const MAX_LATENCY = 2000;
export const LOOP_INTERVAL = 1;
export const TURN_KIND = 29999;

export type NostrTURNSettings = {
    CHUNK_LENGTH: number;
    PACKET_TIMEOUT: number;
    MAX_LATENCY: number;
    LOOP_INTERVAL: number;
    TURN_KIND: number;
};

export default {
    CHUNK_LENGTH,
    PACKET_TIMEOUT,
    MAX_LATENCY,
    LOOP_INTERVAL,
    TURN_KIND,
} as NostrTURNSettings;
