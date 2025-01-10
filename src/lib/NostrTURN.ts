import { base64 } from "@scure/base";
import pako from "pako";
import { NostrKeyPair, NostrAdapter } from "./NostrAdapter";
import { SignedNostrEvent, NostrSubscription } from "./NostrAdapter";
import { PeerInfo } from "./NostrRTC";
import { EventEmitter } from "tseep";
import { getLogger } from "./logger";
import DefaultTURNSettings, { NostrTURNSettings } from "./NostrTURNSettings";

const LOGGER = getLogger("nostrtc:NostrTURN");

type Chunk = {
    data: Uint8Array;
    ack: boolean;
    sent: boolean;
    lastAttempt: number;
};

type Packet = {
    id: number;
    chunks: Chunk[];
    sent: number;
    ack: number;
    timestamp: number;
};

export class NostrTURN extends EventEmitter<{
    data: (peer: PeerInfo, data: Uint8Array) => void;
    close: (peer: PeerInfo, str?: string) => void;
    error: (peer: PeerInfo, error: Error) => void;
}> {
    private readonly localPeer: NostrKeyPair;
    private readonly remotePeer: PeerInfo;
    private readonly connectionId: string;
    private readonly turn: Promise<NostrSubscription>;
    private readonly nostr: NostrAdapter;
    private readonly config: NostrTURNSettings;

    private packetCounter: number = 0;
    private outQueue: { [key: number]: Packet } = {};
    private inPacket: Packet | undefined;
    private loopTimeout?: any;
    private outQueueNotify: any = () => {};
    private stopped: boolean = false;

    constructor(nostr: NostrAdapter, connectionId: string, localKeyPair: NostrKeyPair, remotePeer: PeerInfo, config: NostrTURNSettings = DefaultTURNSettings) {
        super();
        this.config = config;
        this.nostr = nostr;
        this.connectionId = connectionId;
        this.localPeer = localKeyPair;
        this.remotePeer = remotePeer;
        this.turn = nostr.subscribeToRelays(
            [
                {
                    authors: [this.remotePeer.pubkey],
                    kinds: [this.config.TURN_KIND],
                    "#d": ["turn-" + this.connectionId],
                },
            ],
            async (sub, event: SignedNostrEvent) => {
                let content: any = event.content;
                content = await this.nostr.decrypt(this.remotePeer.pubkey, content, this.localPeer);
                content = JSON.parse(content);
                if (content.packet) {
                    await this.onReceivedPacket(content.packet);
                } else if (content.ack) {
                    await this.onReceivedAck(content.ack);
                }
                // const data = pako.inflate(base64.decode(content.data));
                // this.emit("data", remotePeer, data);
            },
            undefined,
            undefined,
            this.remotePeer.turnRelays,
        );

        this.loop().catch((e) => {
            LOGGER.error("Error in turn loop", e);
        });
    }

    public async close(msg?: Error | string): Promise<void> {
        this.stopped = true;
        this.outQueueNotify();
        if (this.loopTimeout) clearTimeout(this.loopTimeout);
        const turn = await this.turn;
        await turn.close();
        if (msg instanceof Error) {
            this.emit("error", this.remotePeer, msg);
        }
        this.emit("close", this.remotePeer, String(msg));
    }

    public async write(data: Uint8Array): Promise<void> {
        await this.turn;
        const b64data = base64.encode(pako.deflate(data));
        const packetId = this.packetCounter++;
        const chunkLen = this.config.CHUNK_LENGTH;
        const chunkCount = Math.ceil(b64data.length / chunkLen);
        LOGGER.trace("Splitting packet", packetId, "in", chunkCount, "chunks");

        const packet = {
            id: packetId,
            chunks: new Array(chunkCount).fill(undefined),
            sent: 0,
            ack: 0,
            timestamp: Date.now(),
        };

        for (let i = 0; i < chunkCount; i++) {
            const chunk = b64data.slice(i * chunkLen, (i + 1) * chunkLen);
            packet.chunks[i] = {
                data: chunk,
                ack: false,
                lastAttempt: 0,
                sent: false,
            };
        }

        this.outQueue[packetId] = packet;

        // move stream forward
        this.consume();

        this.outQueueNotify();
    }

    private async onReceivedAck(content: { packetId: number; chunkId: number }) {
        const packet = this.outQueue[content.packetId];
        const chunk = packet.chunks[content.chunkId];
        if (!chunk) await this.close(new Error("invalid chunk"));
        if (!chunk.ack) {
            chunk.ack = true;
            packet.ack++;
        }

        // move stream forward
        this.consume();
    }

    private async onReceivedPacket(content: { [key: string]: any }) {
        const { packetId, chunkId, nChunks, data } = content;

        // make sure its data for this packet
        if (!this.inPacket) {
            this.inPacket = {
                id: packetId,
                chunks: new Array(nChunks).fill(undefined),
                sent: 0,
                ack: 0,
                timestamp: Date.now(),
            };
        } else if (this.inPacket.id === packetId) {
            if (this.inPacket.chunks.length != nChunks) {
                this.emit("error", this.remotePeer, new Error("Invalid number of chunks"));
                return;
            }
        } else {
            this.emit("error", this.remotePeer, new Error("Invalid packet id"));
            return;
        }

        const packet = this.inPacket;
        if (packet.chunks[chunkId]) {
            this.emit("error", this.remotePeer, new Error("chunk already received"));
            return;
        }

        // append chunk
        packet.chunks[chunkId] = {
            data,
            ack: true,
            sent: true,
            lastAttempt: 0,
        };

        // record ack
        packet.ack++;
        packet.sent = nChunks;

        // move stream forward
        this.consume();

        // send ack
        let ack = JSON.stringify({
            ack: {
                packetId,
                chunkId,
            },
        });
        ack = await this.nostr.encrypt(this.remotePeer.pubkey, ack, this.localPeer);
        await this.nostr.publishToRelays(
            {
                content: ack,
                tags: [
                    ["d", "turn-" + this.connectionId],
                    ["expiration", String(Math.floor((Date.now() + this.config.PACKET_TIMEOUT) / 1000))], // 2 minutes
                ],
                kind: this.config.TURN_KIND,
            },
            this.localPeer,
            this.remotePeer.turnRelays,
        );
    }

    private consume() {
        const packet = this.inPacket;
        // if we have a full packet, emit data and delete it
        if (packet) {
            if (packet.sent === packet.ack) {
                const data = packet.chunks.map((c) => c.data).join("");
                const decoded = pako.inflate(base64.decode(data));
                LOGGER.trace("Reassembling packet", packet.id, "from", packet.chunks.length, "chunks");
                this.emit("data", this.remotePeer, decoded);
                this.inPacket = undefined;
            } else if (Date.now() - packet.timestamp > this.config.PACKET_TIMEOUT) {
                this.close(new Error("Timeout")).catch((e) => LOGGER.error("Error closing", e));
            }
        }

        // if output packet is fully acked, move forward
        for (const packetId in this.outQueue) {
            const packet = this.outQueue[packetId];
            if (packet.sent && packet.sent === packet.ack) {
                LOGGER.trace("Packet", packet.id, "fully acked", packet.ack, "/", packet.sent);
                delete this.outQueue[packetId];
            } else if (Date.now() - packet.timestamp > this.config.PACKET_TIMEOUT) {
                this.close(new Error("Timeout")).catch((e) => LOGGER.error("Error closing", e));
            }
        }
    }

    private async loop() {
        try {
            const packets = Object.values(this.outQueue);
            if (packets.length === 0) {
                await new Promise((resolve) => {
                    this.outQueueNotify = resolve;
                });
            }
            if (this.stopped) return;
            // handle one packet at a time sequentially
            const nextPacket = packets.length > 0 ? packets[0] : undefined;
            if (nextPacket) {
                for (let i = 0; i < nextPacket.chunks.length; i++) {
                    const chunk = nextPacket.chunks[i];
                    const lastAttempt = chunk.lastAttempt;

                    // skip chunk if not acked but still likely to be in transit
                    if (Date.now() - lastAttempt < (this.config.MAX_LATENCY ?? 1000)) {
                        continue;
                    }

                    // skip chunk if acked
                    if (chunk.ack) {
                        continue;
                    }

                    // update last attemp timestamp
                    chunk.lastAttempt = Date.now();

                    // encode and send chunk
                    let content = JSON.stringify({
                        packet: {
                            packetId: nextPacket.id,
                            chunkId: i,
                            nChunks: nextPacket.chunks.length,
                            data: chunk.data,
                        },
                    });
                    content = await this.nostr.encrypt(this.remotePeer.pubkey, content, this.localPeer);

                    // first attempt, we mark it as sent
                    if (!chunk.sent) {
                        chunk.sent = true;
                        nextPacket.sent++;
                    }

                    LOGGER.trace("Sending chunk", nextPacket.id, i);
                    // send
                    await this.nostr.publishToRelays(
                        {
                            content,
                            tags: [
                                ["d", "turn-" + this.connectionId],
                                ["expiration", String(Math.floor((Date.now() + this.config.PACKET_TIMEOUT) / 1000))], // 2 minutes
                            ],
                            kind: this.config.TURN_KIND,
                        },
                        this.localPeer,
                        this.remotePeer.turnRelays,
                    );
                }
            }
        } catch (e) {
            LOGGER.error("Error in turn loop", e);
        }
        if (this.stopped) return;
        this.loopTimeout = setTimeout(() => {
            this.loop().catch((e) => {
                LOGGER.error("Error in turn loop", e);
            });
        }, this.config.LOOP_INTERVAL);
    }
}
