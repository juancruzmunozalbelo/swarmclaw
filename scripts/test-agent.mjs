import { runContainerAgent } from '../dist/container-runner.js';

const group = {
  name: 'test',
  folder: 'test',
  trigger: '@Andy',
  added_at: new Date().toISOString(),
};

const input = {
  prompt: 'Respond with exactly: OK',
  groupFolder: 'test',
  chatJid: 'test@g.us',
  isMain: false,
};

const output = await runContainerAgent(
  group,
  input,
  () => {},
);

console.log(JSON.stringify({ status: output.status, result: output.result }, null, 2));

