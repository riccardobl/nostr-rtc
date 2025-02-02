export const CHUNK_LENGTH = 1024;
export const PACKET_TIMEOUT = 10000;
export const MAX_LATENCY = 2000;
export const LOOP_INTERVAL = 1;
export const TURN_KIND = 29999;

export type NostrTURNSettings = {
    chunkLength: number;
    packetTimeout: number;
    maxLatency: number;
    loopInterval: number;
    kind: number;
};

export default {
    chunkLength: CHUNK_LENGTH,
    packetTimeout: PACKET_TIMEOUT,
    maxLatency: MAX_LATENCY,
    loopInterval: LOOP_INTERVAL,
    kind: TURN_KIND,
} as NostrTURNSettings;
