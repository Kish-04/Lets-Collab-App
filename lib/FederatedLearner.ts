import * as tf from '@tensorflow/tfjs'

export type FederatedFeatures = [number, number, number]

export class FederatedLearner {
    private model: tf.Sequential;
    private xs: FederatedFeatures[] = [];
    private ys: number[][] = [];
    private isTraining: boolean = false;
    private learned: boolean = false;
    // Last global model (or the seeded initial model) and the round it came from; deltas are relative to it
    private baseWeights: number[];
    private modelRound = 0;
    private samplesSinceSync = 0;

    constructor() {
        // Seeded initialisers give every participant the identical starting model, so their
        // deltas can be averaged before any global model exists
        this.model = tf.sequential();
        this.model.add(tf.layers.dense({ units: 8, activation: 'relu', inputShape: [3], kernelInitializer: tf.initializers.glorotUniform({ seed: 1337 }) }));
        this.model.add(tf.layers.dense({ units: 1, activation: 'sigmoid', kernelInitializer: tf.initializers.glorotUniform({ seed: 7331 }) }));
        this.baseWeights = this.model.getWeights().flatMap(w => Array.from(w.dataSync()));

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

    // True once the model has been trained locally or received a federated aggregate
    public hasLearned() {
        return this.learned;
    }

    public getModelRound() {
        return this.modelRound;
    }

    public getBaseWeights() {
        return this.baseWeights.slice();
    }

    // Samples trained on locally since the last global model was applied (the FedAvg weight)
    public getSamplesSinceSync() {
        return this.samplesSinceSync;
    }

    // Local update relative to the last global model; only this (masked) ever leaves the device
    public async getDelta(): Promise<number[]> {
        const current = await this.getSerializedWeights();
        return current.map((value, index) => value - this.baseWeights[index]);
    }

    public async applyGlobal(weights: number[], round: number) {
        const ok = await this.setSerializedWeights(weights);
        if (!ok) return false;
        this.baseWeights = weights.slice();
        this.modelRound = round;
        this.samplesSinceSync = 0;
        return true;
    }

    public async trainLocalModel(epochs: number = 10) {
        if (this.xs.length < 2 || this.isTraining) return null;

        this.isTraining = true;
        // (Errors are no longer muted app-wide while training: that hid every other failure too;
        // known WebAssembly noise is downgraded centrally in app/layout.tsx.)
        const xsTensor = tf.tensor2d(this.xs);
        const ysTensor = tf.tensor2d(this.ys);

        try {
            const history = await this.model.fit(xsTensor, ysTensor, {
                epochs: epochs,
                shuffle: true,
                verbose: 0
            });

            this.samplesSinceSync += this.xs.length;

            this.xs = [];
            this.ys = [];
            this.learned = true;

            const losses = history.history.loss || [];
            return losses[losses.length - 1] ?? null;
        } catch (e) {
            console.warn('[FederatedLearner] local training failed:', e);
            return null;
        } finally {
            xsTensor.dispose(); // also on failure, or the tensors leak GPU/Wasm memory
            ysTensor.dispose();
            this.isTraining = false;
        }
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
            this.learned = true;
            return true;
        } catch (e) {
            console.warn('[FederatedLearner] could not apply the global model:', e);
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
