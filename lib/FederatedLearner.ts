import * as tf from '@tensorflow/tfjs'

// Next.js 15 dev overlay suppression for internal TFJS Wasm logs
if (typeof window !== "undefined") {
    const originalError = console.error;
    console.error = (...args) => {
        const msg = String(args[0] || '').toLowerCase();
        if (msg.includes('index out of bounds') || msg.includes('wasm') || msg.includes('memory') || msg.includes('delegate')) {
            return;
        }
        originalError.apply(console, args);
    };
}

export type FederatedFeatures = [number, number, number]

export class FederatedLearner {
    private model: tf.Sequential;
    private xs: FederatedFeatures[] = [];
    private ys: number[][] = [];
    private isTraining: boolean = false;

    constructor() {
        this.model = tf.sequential();
        this.model.add(tf.layers.dense({ units: 8, activation: 'relu', inputShape: [3] }));
        this.model.add(tf.layers.dense({ units: 1, activation: 'sigmoid' }));
        
        this.model.compile({
            optimizer: tf.train.adam(0.01),
            loss: 'binaryCrossentropy',
            metrics: ['accuracy']
        });
    }

    public addSample(features: FederatedFeatures, label: number) {
        if (this.isTraining) return; // Prevent dataset mutation during active epoch
        this.xs.push(features);
        this.ys.push([label > 0 ? 1 : 0]);
        if (this.xs.length > 500) {
            this.xs.shift();
            this.ys.shift();
        }
    }

    public getPendingSampleCount() {
        return this.xs.length;
    }

    public async trainLocalModel(epochs: number = 10) {
        if (this.xs.length < 2 || this.isTraining) return null;

        const originalError = console.error;
        this.isTraining = true;

        try {
            // Aggressive suppression during heavy compute tasks
            console.error = () => {};

            const xsTensor = tf.tensor2d(this.xs);
            const ysTensor = tf.tensor2d(this.ys);

            const history = await this.model.fit(xsTensor, ysTensor, {
                epochs: epochs,
                shuffle: true,
                verbose: 0
            });

            xsTensor.dispose();
            ysTensor.dispose();

            this.xs = [];
            this.ys = [];

            const losses = history.history.loss || [];
            return losses[losses.length - 1] ?? null;
        } catch (e) {
            return null;
        } finally {
            this.isTraining = false;
            console.error = originalError;
            this.syncGlobalWeights();
        }
    }

    public async syncGlobalWeights() {
        try {
            const weights = await this.getSerializedWeights();
            const BACKEND_URL = typeof window !== 'undefined' ? (window as any)._BACKEND_URL || 'https://let-s-collab-tjwc.onrender.com' : 'https://let-s-collab-tjwc.onrender.com';

            await fetch(`${BACKEND_URL}/api/federated-weights`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ weights })
            });
        } catch (err) {}
    }

    public async getSerializedWeights(): Promise<number[]> {
        const weights = this.model.getWeights();
        const serialized: number[] = [];
        for (const w of weights) {
            const data = await w.data<'float32'>();
            serialized.push(...Array.from(data));
        }
        return serialized;
    }

    public async setSerializedWeights(serialized: number[]): Promise<boolean> {
        try {
            const currentWeights = this.model.getWeights();
            const expectedLength = currentWeights.reduce((total, weight) => total + weight.size, 0);
            if (serialized.length !== expectedLength) return false;

            let offset = 0;
            const tensors = currentWeights.map(weight => {
                const values = serialized.slice(offset, offset + weight.size);
                offset += weight.size;
                return tf.tensor(values, weight.shape, 'float32');
            });

            this.model.setWeights(tensors);
            tensors.forEach(t => t.dispose());
            return true;
        } catch (e) {
            return false;
        }
    }

    public predict(features: [number, number, number]): number {
        return tf.tidy(() => {
            const input = tf.tensor2d([features]);
            const prediction = this.model.predict(input) as tf.Tensor;
            return prediction.dataSync()[0];
        });
    }
}
