import * as tf from '@tensorflow/tfjs'

export class FederatedLearner {
    private model: tf.Sequential;
    private xs: number[][] = [];
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

    // Features: [gazeDeviation (0-1), mouseJitter (0-1), emotionStress (0-1)]
    // Label: [isCheating (0 or 1)]
    public addSample(features: [number, number, number], label: number) {
        this.xs.push(features);
        this.ys.push([label]);
    }

    public async trainLocalModel(epochs: number = 10) {
        if (this.xs.length === 0) return null;

        const xsTensor = tf.tensor2d(this.xs);
        const ysTensor = tf.tensor2d(this.ys);

        const history = await this.model.fit(xsTensor, ysTensor, {
            epochs: epochs,
            shuffle: true,
            verbose: 0
        });

        xsTensor.dispose();
        ysTensor.dispose();

        // Clear local dataset after training to save memory
        this.xs = [];
        this.ys = [];

        return history.history.loss[0];
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

    public predict(features: [number, number, number]): number {
        return tf.tidy(() => {
            const input = tf.tensor2d([features]);
            const prediction = this.model.predict(input) as tf.Tensor;
            const value = prediction.dataSync()[0];
            return value;
        });
    }
}
