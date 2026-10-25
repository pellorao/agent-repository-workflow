/** @param {number} stateVersion @param {number} latestMessageSequence */
export function nextBackgroundAgentSequence(stateVersion,latestMessageSequence) {
  const next=Math.max(stateVersion,latestMessageSequence)+1;
  if(!Number.isSafeInteger(next))throw new Error('Background Agent sequence is exhausted.');
  return next;
}

/** @param {import('./state-store.mjs').BackgroundAgentRow} stored @param {number} latestMessageSequence
 * @returns {import('./state-store.mjs').BackgroundAgentRow} */
export function recoverEndedBackgroundAgent(stored,latestMessageSequence) {
  const stateVersion=nextBackgroundAgentSequence(stored.stateVersion,latestMessageSequence);
  return {...stored,state:'exited',taskState:stored.providerWork?.paused===true?'working':'unknown',stateVersion};
}
