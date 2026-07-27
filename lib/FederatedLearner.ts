import * as tf from '@tensorflow/tfjs'

export type FederatedFeatures = [number, number, number]

export class FederatedLearner {
    private model: tf.Sequential;
    private xs: FederatedFeatures[] = [];
    private ys: number[][] = [];

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

    // Features: [visualAnomaly, interactionAnomaly, audioEmotionAnomaly], each 0-1.
    public addSample(features: FederatedFeatures, label: number) {
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
        if (this.xs.length === 0) return null;

        const xsTensor = tf.tensor2d(this.xs);
        const ysTensor = tf.tensor2d(this.ys);

        let history: tf.History;
        try {
            history = await this.model.fit(xsTensor, ysTensor, {
                epochs: epochs,
                shuffle: true,
                verbose: 0
            });
        } finally {
            xsTensor.dispose();
            ysTensor.dispose();
        }

        // Clear local dataset after training to save memory
        this.xs = [];
        this.ys = [];

        const losses = history.history.loss || [];
        return losses[losses.length - 1] ?? null;
    }

    public async getSerializedWeights(): Promise<number[]> {
        const weights = this.model.getWeights();
        const serialized: number[] = [];
        
        for (const w of weights) {
            const data = await w.data<'float32'>();
            serialized.push(...Array.from(data));
        }
        weights.forEach(weight => weight.dispose());
        
        return serialized;
    }

    public async setSerializedWeights(serialized: number[]): Promise<boolean> {
        if (!Array.isArray(serialized) || serialized.some(value => !Number.isFinite(value))) return false;

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
        tensors.forEach(tensor => tensor.dispose());
        currentWeights.forEach(tensor => tensor.dispose());
        return true;
    }

    public predict(features: [number, number, number]): number {
        return tf.tidy(() => {
            const input = tf.tensor2d([features]);
            const prediction = this.model.predict(input) as tf.Tensor;
            const value = prediction.dataSync()[0];
            return value;
        });
    }
}
