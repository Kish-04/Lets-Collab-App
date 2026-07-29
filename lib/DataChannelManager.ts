type EventCallback = (data: any, peerId: string) => void;

export class DataChannelManager {
    private channels: Map<string, RTCDataChannel> = new Map();
    private listeners: Map<string, Set<EventCallback>> = new Map();

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

        channel.onclose = () => {
            this.channels.delete(id);
        };
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
    }

    public getBufferedAmount(label: string, targetPeerId: string): number {
        const channel = this.channels.get(`${label}-${targetPeerId}`);
        return channel ? channel.bufferedAmount : 0;
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
