/**
 * 根据准确 candidate tag state 决定 guest 首步创建 tag 或后续步骤复用 tag.
 * 首步 collision 和后续 stale identity 都关闭式失败, 不删除或改写既有 tag.
 */
/** @param {{candidateCommit: string, existingTagCommit: string | null, stepIndex: number}} input */
export const resolveReleaseGuestTagAction = ({candidateCommit, existingTagCommit, stepIndex}) => {
    if (!Number.isSafeInteger(stepIndex) || stepIndex < 0) throw new Error('Release guest step index is invalid.');
    if (existingTagCommit === null) {
        if (stepIndex === 0) return 'create';
        throw new Error('Guest candidate version tag is missing after scenario validation began.');
    }
    if (stepIndex === 0) throw new Error('Guest candidate version tag already exists before scenario validation.');
    if (existingTagCommit !== candidateCommit) {
        throw new Error('Guest candidate version tag does not identify the candidate commit.');
    }
    return 'reuse';
};
