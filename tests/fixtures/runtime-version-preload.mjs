const injectedVersion = process.env.ARW_TEST_NODE_VERSION;

if (injectedVersion !== undefined) {
    Object.defineProperty(process.versions, 'node', {
        configurable: true,
        value: injectedVersion,
    });
}
