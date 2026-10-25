const SKILL_IDENTITY = /^[a-z]+(?:-[a-z]+)*$/u;

export const isSkillIdentity = (/** @type {string} */ value) => typeof value === 'string' && SKILL_IDENTITY.test(value);
