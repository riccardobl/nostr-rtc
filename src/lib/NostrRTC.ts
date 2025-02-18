import { NostrAdapter, NostrKeyPair, NostrSubscription, SignedNostrEvent } from "./NostrAdapter";
import { EventEmitter } from "tseep";
import { getLogger } from "./logger";
import { NostrRTCPeer, ConnectionStatus } from "./NostrRTCPeer";
import { NostrTURN } from "./NostrTURN";
import DefaultSettings, { NostrRTCSettings, PUBLIC_STUN_SERVERS } from "./NostrRTCSettings";
import DefaultTURNSettings, { NostrTURNSettings } from "./NostrTURNSettings";

const LOGGER = getLogger("nostrtc:NostrRTC");

export enum SubChannelPrefixes {
    announce = "1",
    offer = "3",
    answer = "4",
    iceCandidate = "5",
    disconnect = "7",
    ack = "8",
    err = "9",
    connect = "10",
}

export class PeerInfo {
    public readonly pubkey: string;
    public readonly metadata: { [key: string]: string } = {};
    public readonly turnRelays?: string[];
    public _lastSeen: number;

    constructor(pubkey: string, metadata: { [key: string]: string } | undefined, turnRelays: string[] | undefined, lastSeen: number) {
        this.pubkey = pubkey;
        if (metadata) Object.assign(this.metadata, metadata);
        this.turnRelays = turnRelays;
        this._lastSeen = lastSeen;
    }

    set lastSeen(lastSeen: number) {
        this._lastSeen = lastSeen;
    }

    get lastSeen(): number {
        return this._lastSeen;
    }
}

export type NostrRTCOptions = {
    stunServers?: string[];
    turnRelays?: string[];
    localKey?: string | NostrKeyPair;
    rtcSettings: NostrRTCSettings;
    turnSettings: NostrTURNSettings;
    useRelaysTurn: boolean;
    useRelaysStun: boolean;
};

export class NostrRTC extends EventEmitter<{
    discover: (peer: PeerInfo) => void;
    close: (peer: PeerInfo, msg?: string | Error) => void;
    refresh: (peer: PeerInfo) => void;
    announce: (peer: PeerInfo) => void;
    cleanup: (peer: PeerInfo) => void;
    candidates: (peer: PeerInfo, candidates: any) => void;
    data: (peer: PeerInfo, data: Uint8Array) => void;

    connecting: (peer: PeerInfo) => void;
    connected: (peer: PeerInfo) => void;
    error: (peer: PeerInfo, error: Error) => void;
}> {
    private readonly discoveredPeers: Array<PeerInfo> = new Array<PeerInfo>();
    private readonly connections: Map<string, NostrRTCPeer> = new Map<string, NostrRTCPeer>();
    private readonly banlist: string[] = [];
    private readonly channelKeyPair: NostrKeyPair;
    private readonly localKeyPair: NostrKeyPair;
    private readonly nostr: NostrAdapter;
    private readonly metadata: { [key: string]: string };
    private readonly config: NostrRTCOptions;

    private readonly turnRelays: string[];
    private readonly signalingRelays: string[];
    private readonly stunServers: string[];

    private sub?: NostrSubscription;
    private stopped: boolean = false;
    private announceTimeout?: any;
    private gcTimeout?: any;
    private autoconnectTimeout?: any;

    constructor(
        nostr: NostrAdapter,
        signalingRelays: string[],
        channelKey: string | NostrKeyPair,
        metadata: { [key: string]: string } = {},
        opts: NostrRTCOptions = {
            rtcSettings: DefaultSettings,
            turnSettings: DefaultTURNSettings,
            useRelaysTurn: true,
            useRelaysStun: true,
        },
    ) {
        super();
        this.nostr = nostr;
        this.channelKeyPair = typeof channelKey === "string" ? nostr.newKeyPair(channelKey) : channelKey;
        this.localKeyPair = typeof opts.localKey === "string" || !opts.localKey ? nostr.newKeyPair(opts.localKey) : opts.localKey;
        this.metadata = metadata;
        this.config = opts;

        this.signalingRelays = [...(signalingRelays ?? [])];
        this.turnRelays = [...(opts.turnRelays ?? [])];
        this.stunServers = [...(opts.stunServers ?? [])];
    }

    public setMetadata(metadata: { [key: string]: string }) {
        Object.keys(this.metadata).forEach((key) => delete this.metadata[key]);
        Object.assign(this.metadata, metadata);
    }

    public getMetadata(): { [key: string]: string } {
        return this.metadata;
    }

    public getTurnRelays(): string[] {
        return this.turnRelays;
    }

    public getStunServers(): string[] {
        return this.stunServers;
    }

    public getSignalingRelays(): string[] {
        return this.signalingRelays;
    }

    public getChannelKeyPair(): NostrKeyPair {
        return this.channelKeyPair;
    }

    public getLocalKeyPair(): NostrKeyPair {
        return this.localKeyPair;
    }

    public getNostrAdapter(): NostrAdapter {
        return this.nostr;
    }

    public async start() {
        this.sub = await this.subscribeToSignal(async (sub, payload, peerPubkey, timestamp) => {
            if (payload.announce) {
                await this.onPeerDiscovery(peerPubkey, timestamp, payload.announce).catch(console.error);
            }
            if (payload.connect) {
                await this.onIncomingPeerConnection(peerPubkey, payload.connect).catch(console.error);
            }
            if (payload.connectAck) {
                await this.onIncomingPeerAck(peerPubkey, payload.connectAck).catch(console.error);
            }
            if (payload.candidates) {
                await this.onIceCandidates(peerPubkey, payload.candidates).catch(console.error);
            }
        });

        // load more turn and stun servers from nip-11 info
        for (const relay of this.signalingRelays) {
            const info = await this.nostr.getInfo(relay);
            if (this.config.useRelaysStun) {
                if (info?.stun?.length) {
                    this.stunServers.push(...info.stun);
                }
            }

            if (this.config.useRelaysTurn) {
                if (info?.turn?.length) {
                    this.turnRelays.push(...info.turn);
                }
            }
        }

        LOGGER.info("Starting NostrRTC with\n    signaling:", this.signalingRelays, "\n    turn:", this.turnRelays, "\n    stun:", this.stunServers);

        this.announceLoop().catch(console.error);
        this.gcLoop().catch(console.error);
        this.autoconnectLoop().catch(console.error);
    }

    private async autoconnectLoop() {
        const p1: string = await this.localKeyPair.getPubKey();
        for (const peer of this.discoveredPeers) {
            const p2: string = peer.pubkey;
            // the peer with the lowest pubkey will initiate the connection (string)
            const autoconnect = p1.localeCompare(p2) < 0;
            if (!autoconnect) continue;

            const hasConnection = this.connections.has(peer.pubkey);
            if (!hasConnection) {
                try {
                    this.connect(peer.pubkey).catch(console.error);
                } catch (e) {
                    LOGGER.debug("Failed to autoconnect", e);
                }
            }
        }
        this.autoconnectTimeout = setTimeout(() => this.autoconnectLoop(), 1000);
    }

    private async gcLoop() {
        if (this.stopped) return;
        const now = Date.now();
        const waitList = [];
        for (let i = 0; i < this.discoveredPeers.length; i++) {
            // remove expired peers
            const peer = this.discoveredPeers[i];
            if (now - peer.lastSeen > this.config.rtcSettings.peerExpiration) {
                this.discoveredPeers.splice(i, 1);
                i--;
                this.emit("cleanup", peer);
                // if there is a connection active, disconnect with error.
                const connection = this.connections.get(peer.pubkey);
                if (connection) {
                    waitList.push(connection.close(new Error("Peer expired")).catch(console.error));
                }
            }
        }
        // wait for all connections to close
        await Promise.allSettled(waitList);
        // remove disconnected connections
        const keys = Array.from(this.connections.keys());
        for (const pubkey of keys) {
            const connection = this.connections.get(pubkey);
            if (connection && connection.getStatus() === ConnectionStatus.disconnected) {
                this.connections.delete(pubkey);
            }
        }
        this.gcTimeout = setTimeout(() => this.gcLoop(), this.config.rtcSettings.gcInterval);
    }

    private getAnnounce(): any {
        return {
            metadata: this.metadata,
            turnRelays: this.turnRelays,
        };
    }

    private async announceLoop() {
        if (this.stopped) return;
        try {
            await this.signal({
                announce: this.getAnnounce(),
            });
        } catch (e) {
            console.error("Failed to announce", e);
        }
        this.announceTimeout = setTimeout(() => this.announceLoop(), this.config.rtcSettings.announceInterval);
    }

    public async connect(pubkey: string): Promise<void> {
        // unban peer if previously banned
        this.unban(pubkey);

        const discoveredPeer = this.discoveredPeers.find((peer) => peer.pubkey === pubkey);
        if (!discoveredPeer) throw new Error("Peer not discovered yet");

        // initialize connection
        let connection = this.connections.get(pubkey);
        if (connection) throw new Error("Peer already connected or connecting");
        connection = new NostrRTCPeer(discoveredPeer, this.stunServers, undefined, this.config.rtcSettings);

        if (discoveredPeer.turnRelays?.length) {
            const turn = new NostrTURN(this.nostr, connection.getConnectionId(), this.localKeyPair, discoveredPeer, this.config.turnSettings);
            turn.on("close", (msg) => {
                connection.close(new Error("Closed by TURN: " + msg)).catch(console.error);
            });
            connection.setTURN(turn);
        }

        // registering hooks
        connection.on("ready", () => {
            this.emit("connected", discoveredPeer);
        });

        connection.on("close", (conn, msg) => {
            this.emit("close", discoveredPeer, msg);
        });

        connection.on("error", (conn, e) => {
            this.emit("error", discoveredPeer, e);
        });

        connection.on("candidates", (conn, candidates: RTCIceCandidate[]) => {
            this.signal(
                {
                    candidates: candidates.map((c) => c.toJSON()),
                },
                discoveredPeer.pubkey,
            ).catch(console.error);
        });

        connection.on("data", (conn, data) => {
            this.emit("data", discoveredPeer, data);
        });

        // register initializing connection
        this.connections.set(pubkey, connection);

        // signal connection request
        const connectionId = connection.getConnectionId();
        this.emit("connecting", discoveredPeer);
        const description = await connection.connect();
        LOGGER.debug("Attempting to connect to", pubkey + "@" + connectionId, "and local description", description);
        await this.signal(
            {
                announce: this.getAnnounce(),
                candidates: connection.getLocalIceCandidates().map((c) => c.toJSON()),
                connect: {
                    connectionId,
                    description,
                },
            },
            pubkey,
        );
    }

    private async onIceCandidates(pubkey: string, candidates: any) {
        const peer = this.discoveredPeers.find((peer) => peer.pubkey === pubkey);
        if (!peer) return;
        const connection = this.connections.get(pubkey);
        if (!connection) return;
        await connection.addRemoteIceCandidates(candidates.map((c: any) => new RTCIceCandidate(c)));
        this.emit("candidates", peer, candidates);
    }

    private async onPeerDiscovery(pubkey: string, timestamp: number, announce: any) {
        const metadata: { [key: string]: string } | undefined = announce.metadata;
        const turnRelays: string[] | undefined = announce.turnRelays;
        if (Date.now() - timestamp > this.config.rtcSettings.peerExpiration) return;
        if (this.banlist.includes(pubkey)) return;
        let peer = this.discoveredPeers.find((peer) => peer.pubkey === pubkey);
        if (!peer) {
            const peer = new PeerInfo(pubkey, metadata, turnRelays, timestamp);
            this.emit("discover", peer);
            this.discoveredPeers.push(peer);
        } else {
            Object.keys(peer.metadata).forEach((key) => delete peer.metadata[key]);
            Object.assign(peer.metadata, metadata);
            peer.lastSeen = timestamp;
            this.emit("refresh", peer);
        }
    }

    private async onIncomingPeerAck(peerPubkey: string, payload: any) {
        const connectionId = payload.connectionId;
        const error = payload.error;
        const remoteDescription = payload.description;
        // check if peer is discovered
        const remotePeer = this.discoveredPeers.find((peer) => peer.pubkey === peerPubkey);
        if (!remotePeer) throw new Error("Peer not discovered yet");
        // check if connection already exists and is connecting
        let connection = this.connections.get(peerPubkey);
        if (!connection) throw new Error("Peer connection not found");
        if (connection.getStatus() !== ConnectionStatus.connecting) throw new Error("Peer not connecting");
        // check if connectionId is the same (prevent replay attacks)
        if (connection.getConnectionId() !== connectionId) throw new Error("Invalid connectionId");
        LOGGER.debug("Incoming connection ack from", peerPubkey + "@" + connectionId, "with remote description", remoteDescription);
        // set remote description
        try {
            if (error) throw new Error(error);
            await connection.setRemoteDescription(remoteDescription);
            LOGGER.info("Connection established to", peerPubkey + "@" + connectionId);
        } catch (e: any) {
            LOGGER.error("Failed to connect", e);
            connection.close(e).catch(console.error);
        }
        this.signal(
            {
                candidates: connection.getLocalIceCandidates().map((c) => c.toJSON()),
            },
            peerPubkey,
        ).catch(console.error);
    }

    private async onIncomingPeerConnection(peerPubkey: string, payload: any) {
        const connectionId = payload.connectionId;
        const remoteDescription = payload.description;
        LOGGER.debug("Incoming connection from", peerPubkey + "@" + connectionId, "with  remote description", remoteDescription);
        // check if peer is discovered
        const remotePeer = this.discoveredPeers.find((peer) => peer.pubkey === peerPubkey);
        if (!remotePeer) throw new Error("Peer not discovered yet");
        let connection: NostrRTCPeer | undefined;
        try {
            // initialize and register connection
            connection = new NostrRTCPeer(remotePeer, this.stunServers, connectionId, this.config.rtcSettings);
            // ({ connection, description } = await NostrRTCPeer.open(remotePeer, connectionId, remoteDescription));
            if (remotePeer.turnRelays?.length) {
                const turn = new NostrTURN(this.nostr, connection.getConnectionId(), this.localKeyPair, remotePeer, this.config.turnSettings);
                turn.on("close", (msg) => {
                    if (connection) connection.close(new Error("Closed by TURN: " + msg)).catch(console.error);
                });
                connection.setTURN(turn);
            }

            this.connections.set(peerPubkey, connection);
            // register hooks
            connection.on("ready", () => {
                connection?.setStatus(ConnectionStatus.connected);
                this.emit("connected", remotePeer);
            });
            connection.on("close", (conn, msg) => {
                this.emit("close", remotePeer, msg);
            });
            connection.on("error", (conn, e) => {
                this.emit("error", remotePeer, e);
            });
            connection.on("candidates", (conn, candidates: RTCIceCandidate[]) => {
                LOGGER.debug("Sending candidates to", peerPubkey + "@" + connectionId, candidates);
                const serialized = candidates.map((c) => c.toJSON());
                this.signal({ candidates: serialized }, remotePeer.pubkey).catch(console.error);
            });

            connection.on("data", (conn, data) => {
                this.emit("data", remotePeer, data);
            });

            const description = await connection.open(remoteDescription);

            LOGGER.debug("Confirm connection to", peerPubkey + "@" + connectionId, "with local description", description);
            this.emit("connecting", remotePeer);

            // signal connection ack
            await this.signal(
                {
                    // announce: this.getAnnounce(),
                    candidates: connection.getLocalIceCandidates().map((c) => c.toJSON()),
                    connectAck: {
                        connectionId,
                        description,
                    },
                },
                peerPubkey,
            );
            LOGGER.info("Connection established to", peerPubkey + "@" + connectionId);
        } catch (e: any) {
            console.error("Failed to connect", e);
            await this.signal(
                {
                    connectAck: {
                        connectionId: connectionId,
                        error: e?.message || "Error",
                    },
                },
                peerPubkey,
            );
            connection?.close(e).catch(console.error);
        }
    }

    public async stop() {
        this.stopped = true;
        if (this.sub) {
            await this.sub.close();
        }
        if (this.announceTimeout) {
            clearTimeout(this.announceTimeout);
        }
        if (this.gcTimeout) {
            clearTimeout(this.gcTimeout);
        }
        if (this.autoconnectTimeout) {
            clearTimeout(this.autoconnectTimeout);
        }
        for (const conn of this.connections.values()) {
            try {
                await conn.close("Stopped");
            } catch (e) {
                console.error("Failed to close connection", e);
            }
        }
        this.connections.clear();
        this.discoveredPeers.length = 0;
        this.banlist.length = 0;
    }

    public unban(pubkey: string) {
        const index = this.banlist.indexOf(pubkey);
        if (index !== -1) {
            this.banlist.splice(index, 1);
        }
    }

    public ban(pubkey: string) {
        if (!this.banlist.includes(pubkey)) {
            this.banlist.push(pubkey);
        }
        let discoveredIndex = this.discoveredPeers.findIndex((peer) => peer.pubkey === pubkey);
        if (discoveredIndex !== -1) {
            this.discoveredPeers.splice(discoveredIndex, 1);
        }
    }

    public async disconnect(pubkey: string) {
        this.ban(pubkey);
        const connection = this.connections.get(pubkey);
        if (connection) {
            await connection.close("Disconnected by user");
        }
    }

    public getConnection(pubkey: string): NostrRTCPeer | undefined {
        return this.connections.get(pubkey);
    }

    public getPeerInfo(pubkey: string): PeerInfo | undefined {
        return this.discoveredPeers.find((peer) => peer.pubkey === pubkey);
    }

    public listPeers(): string[] {
        return this.discoveredPeers.map((peer) => peer.pubkey);
    }

    public async signal(payload: any, peerPubkey?: string) {
        try {
            const d = `${peerPubkey ?? "@"}@${await this.channelKeyPair.getPubKey()}`;
            // LOGGER.trace("Sending from ", await this.localKeyPair.getPubKey(), "to", d, "\n", payload);

            const encryptedPayload = await this.nostr.encrypt(peerPubkey ?? (await this.channelKeyPair.getPubKey()), JSON.stringify(payload), this.localKeyPair);
            await this.nostr.publishToRelays(
                this.signalingRelays,
                {
                    kind: this.config.rtcSettings.kind,
                    content: encryptedPayload,
                    tags: [
                        ["d", d],
                        ["expiration", String(Math.floor((Date.now() + 21 * 60 * 1000) / 1000))], // 21 minutes
                    ],
                },
                this.localKeyPair,
            );
        } catch (e) {
            LOGGER.error("Failed to signal", e);
        }
    }

    public async subscribeToSignal(onPayload: (sub: NostrSubscription, payload: any, peerPubkey: string, timestamp: number) => Promise<void>): Promise<NostrSubscription> {
        const privChannel = `${await this.localKeyPair.getPubKey()}@${await this.channelKeyPair.getPubKey()}`;
        const pubChannel = `@@${await this.channelKeyPair.getPubKey()}`;

        const sub: NostrSubscription = await this.nostr.subscribeToRelays(
            this.signalingRelays,
            [
                {
                    kinds: [this.config.rtcSettings.kind],
                    "#d": [privChannel, pubChannel],
                    since: Math.floor(Date.now() / 1000),
                },
            ],
            async (sub: NostrSubscription, event: SignedNostrEvent) => {
                try {
                    const author: string = event.pubkey;
                    if (author === (await this.localKeyPair.getPubKey())) return;

                    const dtag = String(event.tags.find((tag) => tag[0] === "d")?.[1]);
                    const isPublicChannel: boolean = dtag === pubChannel;

                    const encryptedPayload = event.content;
                    const decryptedPayload = await this.nostr.decrypt(author, encryptedPayload, isPublicChannel ? this.channelKeyPair : this.localKeyPair);
                    const payload = JSON.parse(decryptedPayload);
                    // LOGGER.trace("Received from", author, "to", dtag, "\n", payload);
                    const timestamp = Math.floor(event.created_at ? event.created_at * 1000 : Date.now());
                    if (timestamp < 0 || isNaN(timestamp)) throw new Error("Invalid timestamp");
                    onPayload(sub, payload, author, timestamp).catch(console.error);
                } catch (e) {
                    LOGGER.error("Invalid event", e);
                }
            },
        );

        return sub;
    }
}
