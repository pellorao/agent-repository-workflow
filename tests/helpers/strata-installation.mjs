import {mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';

export const strataTiers = [{context_window: 1000, auto_compact_token_limit: 800}, {context_window: 2000, auto_compact_token_limit: 1500}];

/** Write the Strata installation files ARW reads: one model, `Alpha`, serving the given tiers.
 * @param {string} directory @param {{tiers?: unknown[], prompt?: string}} [options]
 */
export async function writeStrataInstallation(directory, {tiers = strataTiers, prompt = 'Base prompt.'} = {}) {
  await mkdir(join(directory, 'config', 'prompts'), {recursive: true});
  await writeFile(join(directory, 'config', 'frontend.json'), JSON.stringify({listen_address: '127.0.0.1', port: 8101}));
  await writeFile(join(directory, 'config', 'deployment.json'), JSON.stringify({models: ['Alpha'], context_tiers: {Alpha: tiers}}));
  await writeFile(join(directory, 'config', 'prompts', 'compact-prompt.txt'), prompt);
}
