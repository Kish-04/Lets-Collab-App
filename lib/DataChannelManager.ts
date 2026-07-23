type EventCallback = (data: any, peerId: string) => void;

export class DataChannelManager {
    private channels: Map<string, RTCDataChannel> = new Map();
    private listeners: Map<string, Set<EventCallback>> = new Map();

    public attachChannel(channel: RTCDataChannel, peerId: string, label: string) {
        const id = `${label}-${peerId}`;
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
                if (id.startsWith(label) && channel.readyState === 'open') {
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
}

export const dataChannelManager = new DataChannelManager();
