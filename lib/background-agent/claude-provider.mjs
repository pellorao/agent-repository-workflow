/** Reviewer settings with this provider run on the Claude backend. @param {{modelProvider?:unknown}} settings */
export const isClaudeSettings = settings => settings.modelProvider === 'anthropic';
