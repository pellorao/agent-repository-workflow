/** @param {{environment?: NodeJS.ProcessEnv}} [options] */
export const createNodePlatformEnvironment = ({environment = process.env} = {}) => ({
    /** @param {{platform: string}} input */
    currentAgentIdentity({platform}) {
        return platform === 'codex' ? environment.CODEX_THREAD_ID : environment.CLAUDE_CODE_SESSION_ID;
    },
});
