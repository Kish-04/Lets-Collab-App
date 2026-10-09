type EventCallback = (data: any, peerId: string) => void;
type OpenCallback = (peerId: string) => void;

export class DataChannelManager {
    private channels: Map<string, RTCDataChannel> = new Map();
    private listeners: Map<string, Set<EventCallback>> = new Map();
    private openListeners: Map<string, Set<OpenCallback>> = new Map();

    public attachChannel(channel: RTCDataChannel, peerId: string, label: string) {
        const id = `${label}-${peerId}`;
        channel.binaryType = 'arraybuffer';
        this.channels.set(id, channel);

        channel.onmessage = (event) => {
            const callbacks = this.listeners.get(label);
            if (callbacks) {
                // If it's ArrayBuffer (file data), don't parse as JSON
                let data = event.data;
                if (typeof data === 'string') {
                    try {
                        data = JSON.parse(data);
                    } catch (e) {
                        // ignore
                    }
                }
                callbacks.forEach(cb => cb(data, peerId));
            }
        };

        const notifyOpen = () => this.openListeners.get(label)?.forEach(cb => cb(peerId));
        if (channel.readyState === 'open') queueMicrotask(notifyOpen);
        else channel.onopen = notifyOpen;

        channel.onclose = () => {
            this.channels.delete(id);
        };
    }

    // Called with the peer id whenever a channel with this label opens
    public onOpen(label: string, callback: OpenCallback) {
        if (!this.openListeners.has(label)) this.openListeners.set(label, new Set());
        this.openListeners.get(label)!.add(callback);
        return () => { this.openListeners.get(label)?.delete(callback); };
    }

    public getOpenPeers(label: string): string[] {
        const peers: string[] = [];
        this.channels.forEach((channel, id) => {
            if (id.startsWith(`${label}-`) && channel.readyState === 'open') peers.push(id.slice(label.length + 1));
        });
        return peers;
    }

    public send(label: string, data: any, targetPeerId?: string) {
        let payload = typeof data === 'string' || data instanceof ArrayBuffer ? data : JSON.stringify(data);
        
        if (targetPeerId) {
            const channel = this.channels.get(`${label}-${targetPeerId}`);
            if (channel && channel.readyState === 'open') {
                channel.send(payload as any);
            }
        } else {
            // Broadcast to all peers for this label
            this.channels.forEach((channel, id) => {
                if (id.startsWith(`${label}-`) && channel.readyState === 'open') {
                    channel.send(payload as any);
                }
            });
        }
    }

    public on(label: string, callback: EventCallback) {
        if (!this.listeners.has(label)) {
            this.listeners.set(label, new Set());
        }
        this.listeners.get(label)!.add(callback);
    }

    public off(label: string, callback: EventCallback) {
        const callbacks = this.listeners.get(label);
        if (callbacks) {
            callbacks.delete(callback);
        }
    }

    public clearAll() {
        this.channels.forEach(channel => channel.close());
        this.channels.clear();
        this.listeners.clear();
        // Open listeners belong to long-lived subscribers (CRDT docs) that unsubscribe themselves
    }

    public getBufferedAmount(label: string, targetPeerId: string): number {
        const channel = this.channels.get(`${label}-${targetPeerId}`);
        return channel ? channel.bufferedAmount : 0;
    }

    public isOpen(label: string, targetPeerId?: string): boolean {
        if (targetPeerId) {
            const channel = this.channels.get(`${label}-${targetPeerId}`);
            return Boolean(channel && channel.readyState === 'open');
        }
        for (const [id, channel] of this.channels.entries()) {
            if (id.startsWith(`${label}-`) && channel.readyState === 'open') {
                return true;
            }
        }
        return false;
    }

    public async waitForBuffer(label: string, targetPeerId?: string, threshold: number = 65535): Promise<void> {
        if (!targetPeerId) {
            // Wait for all channels of this label to drain
            const promises = [];
            for (const [id, channel] of this.channels.entries()) {
                if (id.startsWith(`${label}-`) && channel.readyState === 'open' && channel.bufferedAmount > threshold) {
                    promises.push(new Promise<void>(resolve => {
                        const check = () => {
                            if (channel.readyState !== 'open' || channel.bufferedAmount <= threshold) {
                                channel.removeEventListener('bufferedamountlow', check);
                                resolve();
                            }
                        };
                        channel.bufferedAmountLowThreshold = threshold;
                        channel.addEventListener('bufferedamountlow', check);
                        setTimeout(() => { channel.removeEventListener('bufferedamountlow', check); resolve(); }, 5000);
                    }));
                }
            }
            await Promise.all(promises);
            return;
        }

        const channel = this.channels.get(`${label}-${targetPeerId}`);
        if (!channel) return;
        
        if (channel.bufferedAmount <= threshold) return;

        return new Promise(resolve => {
            const check = () => {
                if (!channel || channel.readyState !== 'open' || channel.bufferedAmount <= threshold) {
                    channel?.removeEventListener('bufferedamountlow', check);
                    resolve();
                }
            };
            channel.bufferedAmountLowThreshold = threshold;
            channel.addEventListener('bufferedamountlow', check);
            // Fallback interval just in case
            const interval = setInterval(() => {
                if (!channel || channel.readyState !== 'open' || channel.bufferedAmount <= threshold) {
                    clearInterval(interval);
                    channel?.removeEventListener('bufferedamountlow', check);
                    resolve();
                }
            }, 50);
        });
    }
}

export const dataChannelManager = new DataChannelManager();
