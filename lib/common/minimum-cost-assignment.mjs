/**
 * Returns the unique minimum-cost column permutation, or undefined for tied optima.
 * Costs must be a dense square matrix of nonnegative safe integers and remain unchanged.
 * @param {readonly (readonly number[])[]} costs
 * @returns {number[] | undefined}
 */
export const uniqueMinimumCostAssignment = costs => {
    if (!Array.isArray(costs)) throw new TypeError('Costs must be a dense square matrix of nonnegative safe integers.');
    const count = costs.length;
    const integerCosts = Array.from(costs, row => {
        if (!Array.isArray(row) || row.length !== count) throw new TypeError('Costs must be a dense square matrix of nonnegative safe integers.');
        return Array.from(row, cost => {
            if (!Number.isSafeInteger(cost) || cost < 0) throw new TypeError('Costs must be a dense square matrix of nonnegative safe integers.');
            return BigInt(cost);
        });
    });
    /** @type {bigint[]} */
    const rowPotential = Array(count + 1).fill(0n);
    /** @type {bigint[]} */
    const columnPotential = Array(count + 1).fill(0n);
    const owners = Array(count + 1).fill(0);
    const previous = Array(count + 1).fill(0);
    // Hungarian augmentation finds a minimum-cost complete assignment.
    for (let row = 1; row <= count; row += 1) {
        owners[0] = row;
        let column = 0;
        /** @type {Array<bigint | undefined>} */
        const minimum = Array(count + 1).fill(undefined);
        const visited = Array(count + 1).fill(false);
        do {
            visited[column] = true;
            const owner = owners[column];
            let delta = 0n;
            let next = 0;
            for (let candidate = 1; candidate <= count; candidate += 1) if (!visited[candidate]) {
                const cost = integerCosts[owner - 1][candidate - 1] - rowPotential[owner] - columnPotential[candidate];
                let candidateMinimum = minimum[candidate];
                if (candidateMinimum === undefined || cost < candidateMinimum) {
                    candidateMinimum = cost;
                    minimum[candidate] = cost;
                    previous[candidate] = column;
                }
                if (next === 0 || candidateMinimum < delta) { delta = candidateMinimum; next = candidate; }
            }
            for (let candidate = 0; candidate <= count; candidate += 1) {
                if (visited[candidate]) { rowPotential[owners[candidate]] += delta; columnPotential[candidate] -= delta; }
                else {
                    const candidateMinimum = minimum[candidate];
                    if (candidateMinimum !== undefined) minimum[candidate] = candidateMinimum - delta;
                }
            }
            column = next;
        } while (owners[column] !== 0);
        do {
            const predecessor = previous[column];
            owners[column] = owners[predecessor];
            column = predecessor;
        } while (column !== 0);
    }
    const columns = Array(count).fill(0);
    for (let column = 1; column <= count; column += 1) columns[owners[column] - 1] = column - 1;
    const state = Array(count).fill(0);
    /** @returns {boolean} */
    const hasAlternativeCycle = (/** @type {number} */ row) => {
        if (state[row] === 1) return true;
        if (state[row] === 2) return false;
        state[row] = 1;
        for (let column = 0; column < count; column += 1) {
            if (column !== columns[row] && integerCosts[row][column] === rowPotential[row + 1] + columnPotential[column + 1]
                && hasAlternativeCycle(owners[column + 1] - 1)) return true;
        }
        state[row] = 2;
        return false;
    };
    // Other optimal assignments differ by cycles using only zero reduced-cost edges.
    return columns.some((_, row) => hasAlternativeCycle(row)) ? undefined : columns;
};
