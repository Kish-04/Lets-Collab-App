/**
 * Privacy accounting for differentially private federated learning (DP-FedAvg with secure aggregation).
 *
 * Each round, every update is clipped to L2 norm C and the aggregate carries Gaussian noise with
 * standard deviation sigma * C (sigma = the noise multiplier). With secure aggregation the noise is
 * split across devices: each adds sigma * C / sqrt(k), so the sum the server decrypts carries the full
 * sigma * C as long as at least k devices contribute. One device's data changes the sum by at most C.
 *
 * Renyi DP of the Gaussian mechanism with sensitivity C and noise sigma * C is alpha / (2 sigma^2) at
 * every order alpha > 1, and it adds up over rounds. It converts to (epsilon, delta)-DP as
 *   epsilon = min over alpha of [ rounds * alpha / (2 sigma^2) + ln(1 / delta) / (alpha - 1) ]
 * (Mironov, "Renyi Differential Privacy", 2017). No subsampling amplification is assumed, so the
 * figure is conservative: a device is charged for every round it joins.
 */

const ORDERS = [1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 3.5, 4, 5, 6, 8, 10, 12, 14, 16, 20, 24, 32, 48, 64, 96, 128, 256, 512]

/** Epsilon spent after `rounds` rounds at noise multiplier `sigma` (Infinity without noise). */
export function gaussianEpsilon(rounds: number, sigma: number, delta = 1e-5): number {
    if (!(rounds > 0)) return 0
    if (!(sigma > 0) || !(delta > 0 && delta < 1)) return Infinity
    let best = Infinity
    for (const alpha of ORDERS) {
        const epsilon = (rounds * alpha) / (2 * sigma * sigma) + Math.log(1 / delta) / (alpha - 1)
        if (epsilon < best) best = epsilon
    }
    return best
}

/** How many rounds fit in a total epsilon budget at this noise level. */
export function roundsWithinBudget(budget: number, sigma: number, delta = 1e-5, maxRounds = 100000): number {
    if (!(sigma > 0) || !(budget > 0)) return 0
    let low = 0
    let high = maxRounds
    while (low < high) {
        const mid = Math.ceil((low + high) / 2)
        if (gaussianEpsilon(mid, sigma, delta) <= budget) low = mid
        else high = mid - 1
    }
    return low
}
