export const reviewerCapabilityParseRoutePolicy = (/** @type {() => unknown} */ parser) => {
    try {
        return parser();
    } catch (error) {
        throw new Error('route policy parse failed', {cause: error});
    }
};
