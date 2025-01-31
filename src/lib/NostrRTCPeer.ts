import { PeerInfo } from "./NostrRTC";
import { EventEmitter } from "tseep";
import { getLogger } from "./logger";
import { v7 as uuidv7 } from "uuid";
import { NostrTURN } from "./NostrTURN";
import DefaultNostrRTCSettings, { NostrRTCSettings } from "./NostrRTCSettings";

const LOGGER = getLogger("nostrtc:NostrRTCConnection");

export enum ConnectionStatus {
    disconnected = "disconnected",
    connecting = "connecting",
    connected = "connected",
}

export class NostrRTCPeer extends EventEmitter<{
    candidates: (conn: NostrRTCPeer, candidates: RTCIceCandidate[]) => void;

    ready: (conn: NostrRTCPeer) => void;
    close: (conn: NostrRTCPeer, msg?: string | Error) => void;
    error: (conn: NostrRTCPeer, error: Error) => void;

    data: (conn: NostrRTCPeer, data: Uint8Array) => void;

    p2pState: (conn: NostrRTCPeer, isP2P: boolean) => void;
}> {
    private readonly localIceCandidates: RTCIceCandidate[] = [];
    private readonly connectionId: string;
    private readonly rtcConnection?: RTCPeerConnection;
    private readonly info: PeerInfo;
    private readonly settings: NostrRTCSettings;

    private channel?: Promise<RTCDataChannel>;
    private stopped?: boolean;

    private status: ConnectionStatus;
    private lastStatusUpdate: number = Date.now();

    private candidateEmissionTimeout?: any;
    private candidateEmissionLoop?: any;
    private isChannelReady: boolean = false;
    private _useTURN: boolean = false;
    private ready: boolean = false;
    private turn?: NostrTURN;


    constructor(info: PeerInfo, connectionId?: string, settings: NostrRTCSettings = DefaultNostrRTCSettings) {
        super();
        this.connectionId = connectionId ?? uuidv7();
        this.info = info;
        this.settings = settings;
        this.status = ConnectionStatus.connecting;


        this.on("ready", async () => {
            this.setStatus(ConnectionStatus.connected);
        });

        if(typeof RTCPeerConnection === "function"){       
            const switchTOTurn = setTimeout(() => {
                this.useTURN(true);
            }, settings.P2P_TIMEOUT);

            this.rtcConnection = new RTCPeerConnection({ iceServers: settings.STUN_SERVERS.map(s=>({urls:s})) });
            this.channel = new Promise((resolve) => {
                this.rtcConnection!.ondatachannel = (e) => {
                    const channel = e.channel;
                    this.initDataChannel(e.channel);
                    clearTimeout(switchTOTurn);
                    resolve(channel);
                };
            });

            const emitCandidates = () => {
                if (this.candidateEmissionTimeout) clearTimeout(this.candidateEmissionTimeout);

                this.candidateEmissionTimeout = setTimeout(() => {
                    this.emit("candidates", this, this.localIceCandidates);
                }, 1000);
            };

            this.rtcConnection.onicecandidate = (e) => {
                let updated = false;
                if (e.candidate) {
                    if (!this.localIceCandidates.includes(e.candidate)) {
                        this.localIceCandidates.push(e.candidate);
                        updated = true;
                    }
                }
                if (updated) {
                    emitCandidates();
                }
            };

            this.rtcConnection.oniceconnectionstatechange = () => {
                const useTURN = this.rtcConnection!.iceConnectionState === "failed";
                this.useTURN(useTURN);
            };

            this.candidateEmissionLoop = setInterval(() => {
                emitCandidates();
            }, 10000);
        }       
    }

    public useTURN(useTURN: boolean) {
        if (this._useTURN !== useTURN) {
            this.emit("p2pState", this, !useTURN);
        }
        this._useTURN = useTURN;
        if(useTURN){
            LOGGER.warn("Switching to TURN");
            this.markReady();
        } else {
            LOGGER.info("Switching to P2P");
        }
    }

    private markReady(){
        if(this.ready)return;
        this.ready = true;
        this.emit("ready", this);
    }

    public setStatus(status: ConnectionStatus) {
        this.status = status;
        this.lastStatusUpdate = Date.now();
    }

    public getStatus(): ConnectionStatus {
        if (this.status === ConnectionStatus.connecting && Date.now() - this.lastStatusUpdate > this.settings.CONNECTING_TIMEOUT) {
            return ConnectionStatus.disconnected;
        }
        return this.status;
    }

    public getConnectionId(): string {
        return this.connectionId;
    }

    public getInfo() {
        return this.info;
    }

    public getLocalIceCandidates(): RTCIceCandidate[] {
        return this.localIceCandidates;
    }

    private initDataChannel(channel: RTCDataChannel) {
        const onOpen = () =>{
            channel.binaryType = "arraybuffer";
            channel.addEventListener("message", (e) => {
                const data: Uint8Array = e.data;
                this.emit("data", this, data);
            });
            this.markReady();
            channel.removeEventListener("open", onOpen);
        };

        channel.addEventListener("close", () => {
            this.emit("close", this);
        });

        channel.addEventListener("error", (e: RTCErrorEvent) => {
            this.emit("error", this, e.error);
        });

        if (channel.readyState === "open") {
            onOpen();
        } else {
            channel.addEventListener("open", onOpen);
        }
    }

    public async connect(): Promise<RTCSessionDescriptionInit | undefined> {
        if(!this.rtcConnection){
            this.useTURN(true);
            return undefined;
        }
        const channel = this.rtcConnection.createDataChannel(`nostr_rtc:${this.connectionId}`);
        this.initDataChannel(channel);
        this.channel = Promise.resolve(channel);

        const offer = await this.rtcConnection.createOffer();
        await this.rtcConnection?.setLocalDescription(offer);
        
        return {
            sdp: offer.sdp,
            type: offer.type,
        };
    }

    public async open(description: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit | undefined> {
        if(!this.rtcConnection || !description ){
            this.useTURN(true);
            return undefined;
        }
        await this.rtcConnection.setRemoteDescription(new RTCSessionDescription(description));
        const answer = await this.rtcConnection.createAnswer();
        if (!answer) throw new Error("No answer");
        await this.rtcConnection?.setLocalDescription(answer);
        return {
            sdp: answer.sdp,
            type: answer.type,
        };
    }

    public async setRemoteDescription(description: RTCSessionDescriptionInit|undefined) {
        if(!this.rtcConnection || !description ){
            this.useTURN(true);
            return;
        }
        await this.rtcConnection.setRemoteDescription(new RTCSessionDescription(description));
    }

    public async addRemoteIceCandidates(candidates: RTCIceCandidate[]) {
        if(!this.rtcConnection) return;
        for (const candidate of candidates) {
            await this.rtcConnection?.addIceCandidate(candidate);
        }
    }

    public async close(msg?: Error | string) {
        if (this.stopped) return;
        const channel = await this.channel;
        this.stopped = true;
        if (channel) {
            channel.close();
        }
        if (this.rtcConnection) {
            this.rtcConnection.close();
        }
        this.setStatus(ConnectionStatus.disconnected);
        if (msg && msg instanceof Error) {
            this.emit("error", this, msg);
        }
        this.emit("close", this, msg);
        if (this.candidateEmissionTimeout) clearTimeout(this.candidateEmissionTimeout);
        if (this.candidateEmissionLoop) clearInterval(this.candidateEmissionLoop);
        if (this.turn) {
            await this.turn.close();
        }
    }

    private async getChannel(): Promise<RTCDataChannel> {
        if (!this.channel) throw new Error("No channel");
        const channel = await this.channel;

        if (channel.readyState !== "open") {
            await new Promise((resolve, reject) => {
                const onOpen = () => {
                    channel.removeEventListener("open", onOpen);
                    resolve(undefined);
                };
                channel.addEventListener("error", (e) => {
                    LOGGER.error("Channel error", e);
                    reject(e);
                });
                channel.addEventListener("close", () => {
                    reject(new Error("Channel closed"));
                });
                channel.addEventListener("open", onOpen);
            });
        }
        if (!this.isChannelReady) {
            channel.addEventListener("error", (e) => {
                this.emit("error", this, e.error);
            });
            channel.addEventListener("close", () => {
                this.close("Channel closed").catch((e) => {
                    LOGGER.error("Failed to close connection", e);
                });
            });
            this.isChannelReady = true;
        }
        return channel;
    }

    public setTURN(turn: NostrTURN) {
        this.turn = turn;
        this.turn.on("data", (peer: PeerInfo, data: Uint8Array) => {
            this.emit("data", this, data);
        });
    }

    public isTURN(): boolean {
        return  !!this.turn && this._useTURN;
    }

    public async write(data: Uint8Array) {
        const useTURN = this.isTURN();
        if (useTURN) {
            await this.turn?.write(data);
        } else {
            const channel = await this.getChannel();
            channel.send(data);
        }
    }
}
