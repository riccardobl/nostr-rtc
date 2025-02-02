// import{setGlobalLoggerConfig} from "./logger";

import { NDKAdapter } from "../../lib/NDKAdapter";
import { NostrRTC } from "../../lib/NostrRTC";
import NDK, { NDKPrivateKeySigner, NDKRelaySet } from "@nostr-dev-kit/ndk";
import { getLogger, setGlobalLoggerTag } from "../../lib/logger";
import { PeerInfo } from "../../lib/NostrRTC";

// init logger
const LOGGER = getLogger("nostrtc");
setGlobalLoggerTag("app", "nostrtc");
//

async function start(channelPrivateKey: string, relay: string) {
    let infoEl = document.querySelector("#info");
    if (!infoEl) {
        infoEl = document.createElement("div");
        infoEl.id = "info";
        document.body.appendChild(infoEl);
    }

    let peersEl = document.querySelector("#peers");
    if (!peersEl) {
        peersEl = document.createElement("div");
        peersEl.id = "peers";
        document.body.appendChild(peersEl);
    }

    const localUser: NDKPrivateKeySigner = await NDKPrivateKeySigner.generate();
    LOGGER.trace("Logger loaded with ENDPOINT:", process.env.LOGPIPE_ENDPOINT, "LEVEL:", process.env.LOG_LEVEL);

    if (window.location.hash) setGlobalLoggerTag("user", window.location.hash);
    else setGlobalLoggerTag("user", (await localUser.user()).pubkey);

    infoEl.innerHTML = `Your pubkey: ${(await localUser.user()).pubkey}`;

    setGlobalLoggerTag("channel", channelPrivateKey);

    const relays = [relay];
    const ndk = new NDK({
        explicitRelayUrls: relays,
    });
    const nostr = new NDKAdapter(ndk);

    const rtc = new NostrRTC(nostr, relays, channelPrivateKey, {});

    const updatePeer = (peer: PeerInfo, log: string, candidates?: any) => {
        const pubkey = peer.pubkey;
        let peerEl = peersEl.querySelector(`#p${pubkey}`);
        let pubKeyEl;
        let lastSeenEl;
        let statusEl;
        let candidatesEl;
        let logsEl;

        if (!peerEl) {
            peerEl = document.createElement("div");
            peerEl.id = "p" + pubkey;
            peersEl.appendChild(peerEl);
            pubKeyEl = document.createElement("div");
            pubKeyEl.classList.add("pubkey");
            lastSeenEl = document.createElement("div");
            lastSeenEl.classList.add("lastseen");
            statusEl = document.createElement("div");
            statusEl.classList.add("status");
            candidatesEl = document.createElement("div");
            candidatesEl.classList.add("candidates");
            logsEl = document.createElement("div");
            logsEl.classList.add("logs");
            peerEl.appendChild(pubKeyEl);
            peerEl.appendChild(lastSeenEl);
            peerEl.appendChild(statusEl);
            peerEl.appendChild(candidatesEl);
            peerEl.appendChild(logsEl);
        } else {
            pubKeyEl = peerEl.querySelector("div:nth-child(1)");
            lastSeenEl = peerEl.querySelector("div:nth-child(2)");
            statusEl = peerEl.querySelector("div:nth-child(3)");
            candidatesEl = peerEl.querySelector("div:nth-child(4)");
            logsEl = peerEl.querySelector("div:nth-child(5)");
        }
        peerEl.classList.add("peer");

        const conn = rtc.getConnection(peer.pubkey);
        (pubKeyEl as any).innerHTML = pubkey;
        (lastSeenEl as any).innerHTML = peer.lastSeen;
        (statusEl as any).innerHTML = !conn ? "disconnected" : conn.getStatus() + ":" + conn?.getConnectionId();
        if (candidates) (candidatesEl as any).innerHTML = JSON.stringify(candidates);
        (logsEl as any).innerHTML += log + "<br>";
    };
    rtc.on("discover", async (peer: PeerInfo) => {
        updatePeer(peer, "Discovered peer");
    });
    rtc.on("refresh", async (peer: PeerInfo) => {
        updatePeer(peer, "Refreshed peer");
    });
    let messageInterval: any = undefined;
    rtc.on("connected", async (peer: PeerInfo) => {
        updatePeer(peer, "Connected peer");
        const conn = rtc.getConnection(peer.pubkey);
        conn!.on("data", (conn, data: Uint8Array) => {
            const msg = "!!! Data received: " + new TextDecoder().decode(data) + " TURN: " + conn.isTURN();
            console.log(msg);
            updatePeer(peer, msg);
        });
        messageInterval = setInterval(async () => {
            console.log("Sending message to ", peer.pubkey);
            const data = new TextEncoder().encode("Hello from " + (await localUser.user()).pubkey + ":" + new Date().toISOString());
            await conn?.write(data);
        }, 1000);
    });
    rtc.on("candidates", async (peer: PeerInfo, candidates: any) => {
        updatePeer(peer, "Update candidates", candidates);
    });

    rtc.on("connecting", async (peer: PeerInfo) => {
        updatePeer(peer, "Connecting peer");
    });

    rtc.on("error", async (peer: PeerInfo, error: Error) => {
        updatePeer(peer, error.toString());
    });
    rtc.on("close", async (peer: PeerInfo) => {
        clearInterval(messageInterval);
        updatePeer(peer, "Close");
    });

    rtc.on("cleanup", async (peer: PeerInfo) => {
        const pubkey = peer.pubkey;
        let peerEl = peersEl.querySelector(`#p${pubkey}`);
        if (peerEl) {
            peerEl.remove();
        }
    });

    rtc.start().catch(console.error);
}

function setrelay() {
    const relay = prompt("Enter relay url")?.trim();
    window.location.hash = window.location.hash.split("@")[0] + "@" + relay;
    window.location.reload();
}

function newchannel() {
    const [channelPrivateKey, relay] = (window.location.hash?.substring(1) ?? "").split("@");
    window.location.hash = "@" + relay;
    window.location.reload();
}

function joinchannel() {
    const channel = prompt("Enter channel address")?.trim();
    if (channel) {
        window.location.hash = channel;
        window.location.reload();
    }
}

async function main() {
    const setrelayBtn = document.querySelector("#setrelay");
    if (setrelayBtn) setrelayBtn.addEventListener("click", setrelay);

    const newchannelBtn = document.querySelector("#newchannel");
    if (newchannelBtn) newchannelBtn.addEventListener("click", newchannel);

    const joinchannelBtn = document.querySelector("#joinchannel");
    if (joinchannelBtn) joinchannelBtn.addEventListener("click", joinchannel);

    const channelEl = document.querySelector("#channel");
    let [channelPrivateKey, relay] = (window.location.hash?.substring(1) ?? "").split("@");

    if (!channelPrivateKey || !channelPrivateKey.match(/^[a-zA-Z0-9]+$/)) {
        channelPrivateKey = "";
    }
    if (!relay || !relay.match(/^wss?:\/\/[a-zA-Z0-9.]+$/)) {
        relay = "wss://nostr.rblb.it";
    }

    if (!channelPrivateKey) {
        const tmpSigner = await NDKPrivateKeySigner.generate();
        channelPrivateKey = tmpSigner.privateKey!;
        window.location.hash = channelPrivateKey + "@" + relay;
    }
    if (channelEl) channelEl.innerHTML = "Channel: " + channelPrivateKey + "@" + relay;
    await start(channelPrivateKey, relay);
}

window.addEventListener("load", main);
