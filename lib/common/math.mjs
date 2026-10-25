export const mean = (/** @type {number[]} */ values) => values.length ? values.reduce((sum,value) => sum + value,0) / values.length : null;
