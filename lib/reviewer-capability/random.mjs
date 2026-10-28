// Python-compatible `random.Random(seed).shuffle` (MT19937), so pools match the ones qwen_strata built byte for byte.

const initGenrand = (/** @type {Uint32Array} */ state, /** @type {number} */ seed) => {
    state[0] = seed >>> 0;
    for (let index = 1; index < 624; index += 1) {
        const previous = state[index - 1] ^ (state[index - 1] >>> 30);
        state[index] = (Math.imul(1812433253, previous) + index) >>> 0;
    }
};

/** @param {number} seed non-negative safe integer */
export const createRandom = seed => {
    const state = new Uint32Array(624);
    initGenrand(state, 19650218);
    const key = [];
    for (let rest = BigInt(seed); key.length === 0 || rest > 0n; rest >>= 32n) key.push(Number(rest & 0xffffffffn));
    let i = 1;
    let j = 0;
    for (let k = Math.max(624, key.length); k > 0; k -= 1) {
        const previous = state[i - 1] ^ (state[i - 1] >>> 30);
        state[i] = ((state[i] ^ Math.imul(previous, 1664525)) + key[j] + j) >>> 0;
        i += 1;
        j += 1;
        if (i >= 624) { state[0] = state[623]; i = 1; }
        if (j >= key.length) j = 0;
    }
    for (let k = 623; k > 0; k -= 1) {
        const previous = state[i - 1] ^ (state[i - 1] >>> 30);
        state[i] = ((state[i] ^ Math.imul(previous, 1566083941)) - i) >>> 0;
        i += 1;
        if (i >= 624) { state[0] = state[623]; i = 1; }
    }
    state[0] = 0x80000000;
    let position = 624;
    const next = () => {
        if (position >= 624) {
            for (let n = 0; n < 624; n += 1) {
                const y = (state[n] & 0x80000000) | (state[(n + 1) % 624] & 0x7fffffff);
                state[n] = state[(n + 397) % 624] ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0);
            }
            position = 0;
        }
        let y = state[position];
        position += 1;
        y ^= y >>> 11;
        y ^= (y << 7) & 0x9d2c5680;
        y ^= (y << 15) & 0xefc60000;
        y ^= y >>> 18;
        return y >>> 0;
    };
    const below = (/** @type {number} */ n) => {
        const bits = 32 - Math.clz32(n);
        let r = next() >>> (32 - bits);
        while (r >= n) r = next() >>> (32 - bits);
        return r;
    };
    return {
        shuffle: (/** @type {unknown[]} */ values) => {
            for (let n = values.length - 1; n > 0; n -= 1) {
                const m = below(n + 1);
                [values[n], values[m]] = [values[m], values[n]];
            }
        },
    };
};
