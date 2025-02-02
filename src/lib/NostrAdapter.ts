export type NostrEvent = {
    created_at?: number;
    content: string;
    tags: string[][];
    kind: number;
    pubkey?: string;
};

export type SignedNostrEvent = NostrEvent & {
    id: string;
    sig: string;
    pubkey: string;
    signatureVerified: boolean;
    relays: Set<string>;
};

export type NostrFilter = {
    ids?: string[];
    kinds?: number[];
    authors?: string[];
    since?: number;
    until?: number;
    limit?: number;
    search?: string;
    [key: `#${string}`]: string[] | undefined;
};

export type NostrSubscription = {
    close(): Promise<void>;
};

export type NostrKeyPair = {
    priv(): Promise<string>;
    getPubKey(): Promise<string>;
};

export interface NostrAdapter {
    publishToRelays(relays: string[], eventTemplate: NostrEvent, keyPair: NostrKeyPair): Promise<SignedNostrEvent>;
    subscribeToRelays(
        relays: string[],
        filters: NostrFilter[],
        onEvent: (sub: NostrSubscription, event: SignedNostrEvent) => Promise<void>,
        onClose?: (sub: NostrSubscription) => Promise<void>,
        onEose?: (sub: NostrSubscription) => Promise<void>,
    ): Promise<NostrSubscription>;
    encrypt(recipient: string, data: string, keyPair: NostrKeyPair): Promise<string>;
    decrypt(sender: string, data: string, keyPair: NostrKeyPair): Promise<string>;
    newKeyPair(privKey?: string): NostrKeyPair;
    getInfo(relay: string): Promise<{ [key: string]: string }>;
}
