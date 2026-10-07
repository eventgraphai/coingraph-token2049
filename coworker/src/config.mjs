import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';

// Non-secret settings live in coworker/.local/config.json; secrets come from the environment or a private
// env file outside the repo (COWORKER_ENV_FILE, default ~/.coingraph-coworker/worker.env, permission 600).
export const repo = resolve(import.meta.dirname, '..');
export const privateDir = resolve(process.env.COWORKER_STATE_DIR || resolve(repo, '.local'));

export function readEnv(path) {
  try {
    return Object.fromEntries(readFileSync(path, 'utf8').split('\n').flatMap(line => {
      const match = line.match(/^([A-Z_0-9]+)=(.*)$/);
      return match ? [[match[1], match[2].replace(/^(["'])(.*)\1$/, '$2')]] : [];
    }));
  } catch { return {}; }
}

export function secrets() {
  const file = readEnv(process.env.COWORKER_ENV_FILE || resolve(homedir(), '.coingraph-coworker/worker.env'));
  const pick = name => process.env[name] || file[name] || '';
  return { MPS_TOKEN: pick('MPS_TOKEN'), BLOCKFROST_API_KEY_PREPROD: pick('BLOCKFROST_API_KEY_PREPROD'), COWORKER_SECRET: pick('COWORKER_SECRET') };
}

export function config() {
  // Hosted: the same non-secret settings arrive as COWORKER_CONFIG_JSON.
  if (process.env.COWORKER_CONFIG_JSON) return JSON.parse(process.env.COWORKER_CONFIG_JSON);
  return JSON.parse(readFileSync(resolve(privateDir, 'config.json'), 'utf8'));
}
