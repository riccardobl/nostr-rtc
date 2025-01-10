import { NDKAdapter } from "../lib/NDKAdapter";
import { NostrRTC } from "../lib/NostrRTC";
import NDK, { NDKPrivateKeySigner, NDKRelaySet } from "@nostr-dev-kit/ndk";

export default {
    connect: async (channelPrivateKey: string, relays: string[], privKey?: string): Promise<NostrRTC> => {
        const localUser: NDKPrivateKeySigner = privKey ? new NDKPrivateKeySigner(privKey) : NDKPrivateKeySigner.generate();
        const ndk = new NDK({ explicitRelayUrls: relays });
        const nostr = new NDKAdapter(ndk, NDKRelaySet.fromRelayUrls(relays, ndk));
        const rtc = new NostrRTC(channelPrivateKey, nostr, {}, relays, localUser.privateKey);
        return rtc;
    },
};
