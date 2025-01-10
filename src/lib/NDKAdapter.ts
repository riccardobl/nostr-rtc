import { NostrAdapter, NostrEvent, SignedNostrEvent, NostrFilter, NostrSubscription, NostrKeyPair } from "./NostrAdapter";
import NDK, { NDKRelaySet, NDKRelay, NDKSubscription, NDKEvent, NDKFilter, NDKPrivateKeySigner, NDKUser } from "@nostr-dev-kit/ndk";
import { getLogger } from "./logger";

const LOGGER = getLogger("nostrtc:NDKAdapter");

export class NDKAdapter implements NostrAdapter {
    private readonly ndk: NDK;
    private readonly relaySet: NDKRelaySet;
    private signers: WeakMap<NostrKeyPair, NDKPrivateKeySigner> = new WeakMap();

    constructor(ndk: NDK, relaySet: NDKRelaySet) {
        this.ndk = ndk;
        this.relaySet = relaySet;
    }

    private async getSigner(keyPair: NostrKeyPair): Promise<NDKPrivateKeySigner> {
        if (!this.signers.has(keyPair)) {
            this.signers.set(keyPair, new NDKPrivateKeySigner(await keyPair.priv()));
        }
        return this.signers.get(keyPair)!;
    }

    public async publishToRelays(eventTemplate: NostrEvent, signerKeyPair: NostrKeyPair, relays?: string[]): Promise<SignedNostrEvent> {
        const ndkEventTemplate: any = {
            created_at: eventTemplate.created_at || Math.floor(Date.now() / 1000),
            content: eventTemplate.content,
            tags: eventTemplate.tags,
            kind: eventTemplate.kind,
            pubkey: eventTemplate.pubkey,
        };
        const signer = await this.getSigner(signerKeyPair);
        const event = new NDKEvent(this.ndk, ndkEventTemplate);
        await event.sign(signer);
        if (!event.sig || !event.pubkey || !event.content || !event.created_at || !event.kind) throw new Error("Failed to sign event");
        const relaySet = relays ? NDKRelaySet.fromRelayUrls(relays, this.ndk) : this.relaySet;
        const rs = await relaySet.publish(event);
        const signedEvent: SignedNostrEvent = {
            id: event.id,
            sig: event.sig,
            pubkey: event.pubkey,
            signatureVerified: event.signatureVerified || false,
            content: event.content,
            created_at: event.created_at,
            kind: event.kind,
            tags: event.tags,
            relays: relays ? new Set(Array.from(rs).map((r: NDKRelay) => r.url)) : new Set(),
        };
        return signedEvent;
    }

    public async subscribeToRelays(
        filters: NostrFilter[],
        onEvent: (sub: NostrSubscription, event: SignedNostrEvent) => Promise<void>,
        onClose?: (sub: NostrSubscription) => Promise<void>,
        onEose?: (sub: NostrSubscription) => Promise<void>,
        relays?: string[],
    ): Promise<NostrSubscription> {
        const relaySet = relays ? NDKRelaySet.fromRelayUrls(relays, this.ndk) : this.relaySet;

        const ndkFilters: NDKFilter[] = filters.map((f: NostrFilter) => {
            const ndkFilter: NDKFilter = {
                ids: f.ids,
                kinds: f.kinds,
                authors: f.authors,
                since: f.since,
                until: f.until,
                limit: f.limit,
                search: f.search,
            };
            for (const [key, value] of Object.entries(f)) {
                if (key.startsWith("#")) {
                    ndkFilter[key as any] = value as any;
                }
            }
            return ndkFilter;
        });

        const ndkSub: NDKSubscription = this.ndk.subscribe(ndkFilters, undefined, relaySet, false);
        const sub: NostrSubscription = {
            close: async () => {
                await ndkSub.stop();
            },
        };
        ndkSub.on("event", async (ndkEvent: NDKEvent) => {
            try {
                if (onEvent) {
                    if (!ndkEvent.sig || !ndkEvent.pubkey || !ndkEvent.content || !ndkEvent.created_at || !ndkEvent.kind) throw new Error("Invalid event");
                    const event: SignedNostrEvent = {
                        id: ndkEvent.id,
                        sig: ndkEvent.sig,
                        pubkey: ndkEvent.pubkey,
                        signatureVerified: ndkEvent.signatureVerified || false,
                        content: ndkEvent.content,
                        created_at: ndkEvent.created_at,
                        kind: ndkEvent.kind,
                        tags: ndkEvent.tags,
                        relays: new Set(Array.from(relaySet?.relays ?? []).map((r: NDKRelay) => r.url)),
                    };
                    await onEvent(sub, event);
                }
            } catch (e) {
                LOGGER.error("Invalid event", e);
            }
        });
        ndkSub.on("close", async () => {
            try {
                if (onClose) await onClose(sub);
            } catch (e) {
                LOGGER.error("Invalid event", e);
            }
        });
        ndkSub.on("eose", async () => {
            try {
                if (onEose) await onEose(sub);
            } catch (e) {
                LOGGER.error("Invalid event", e);
            }
        });
        await ndkSub.start();
        return sub;
    }

    public async encrypt(recipient: string, data: string, senderKeyPair: NostrKeyPair): Promise<string> {
        const signer = await this.getSigner(senderKeyPair);
        const recipientUser: NDKUser = new NDKUser({
            pubkey: recipient,
        });
        const res = await signer?.nip04Encrypt(recipientUser, data);
        if (!res) throw new Error("Failed to encrypt");
        return res;
    }

    public async decrypt(sender: string, data: string, receiverKeyPair: NostrKeyPair): Promise<string> {
        const signer = await this.getSigner(receiverKeyPair);
        const senderUser: NDKUser = new NDKUser({
            pubkey: sender,
        });
        const res = await signer?.nip04Decrypt(senderUser, data);
        if (!res) throw new Error("Failed to decrypt");
        return res;
    }

    public newKeyPair(privKey?: string): NostrKeyPair {
        const localUser: NDKPrivateKeySigner = privKey ? new NDKPrivateKeySigner(privKey) : NDKPrivateKeySigner.generate();
        return {
            getPubKey: async () => {
                await localUser.blockUntilReady();
                return (await localUser.user()).pubkey;
            },
            priv: async () => {
                await localUser.blockUntilReady();
                return localUser.privateKey || "";
            },
        };
    }
}
