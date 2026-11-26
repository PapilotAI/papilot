import { readFileSync } from 'node:fs';
import { Command } from 'commander';

export async function handoff(args) {
  const { register } = await import('tsx/esm/api');
  register();
  const { Repo } = await import('../engine/src/core/git.ts');
  const {
    createHandoffRequest, handoffCommit, handoffGit, handoffReceipt, handoffReceiptMarkdown, handoffRecord,
    handoffRequestMarkdown, handoffTaskPrompt, validateHandoffProposal,
  } = await import('../src/server/review-handoff.ts');

  async function inputs(repo, requestFile, proposalFile) {
    if (requestFile === '-') throw new Error('Pass the original local request file. Only the proposal can come from standard input.');
    const read = file => new TextDecoder('utf-8', { fatal: true }).decode(readFileSync(file === '-' ? 0 : file));
    const request = handoffRecord(read(requestFile), 'request');
    return validateHandoffProposal(repo, request, handoffRecord(read(proposalFile), 'proposal', request.requestId));
  }

  const cli = new Command().name('papilot handoff').description('Exchange versioned review suggestions with another agent (experimental).');
  const command = (name, description) => cli.command(name).description(description).option('-C, --repo <folder>', 'Git working directory', process.cwd());
  command('request', 'Write a review request for the current Git commit.')
    .requiredOption('--question <text>', 'What the reviewer should check')
    .option('--include-source', 'Include the selected files as they appear in the commit')
    .argument('<files...>', 'Repository-relative UTF-8 text files')
    .action(async (files, options) => {
      const repo = new Repo(options.repo);
      const request = await createHandoffRequest(repo, await handoffCommit(repo, 'HEAD'), options.question, files);
      console.log(await handoffRequestMarkdown(repo, request, options.includeSource));
    });
  command('prepare', 'Validate a proposal and print a task for a local agent.')
    .arguments('<request> <proposal>')
    .action(async (requestFile, proposalFile, options) => {
      const repo = new Repo(options.repo), review = await inputs(repo, requestFile, proposalFile);
      if (await handoffCommit(repo, 'HEAD') !== review.baseCommit) throw new Error(`Open a worktree at the requested base commit ${review.baseCommit}.`);
      if ((await handoffGit(repo, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignore-submodules=none'])).length) {
        throw new Error('Use a clean worktree. Keep the review exchange files outside that worktree.');
      }
      console.log(handoffTaskPrompt(review));
    });
  command('receipt', 'Check committed changes and print a receipt for review.')
    .requiredOption('--result <ref>', 'Commit containing the work to review')
    .arguments('<request> <proposal>')
    .action(async (requestFile, proposalFile, options) => {
      const repo = new Repo(options.repo), review = await inputs(repo, requestFile, proposalFile);
      console.log(handoffReceiptMarkdown(await handoffReceipt(repo, review, await handoffCommit(repo, options.result))));
    });
  try {
    await cli.parseAsync(args, { from: 'user' });
  } catch (error) {
    console.error(error.message);
    return 1;
  }
}
