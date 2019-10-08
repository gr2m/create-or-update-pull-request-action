const assert = require("assert");
const { inspect } = require("util");

const { command } = require("execa");
const core = require("@actions/core");
const { request } = require("@octokit/request");

const TEMPORARY_BRANCH_NAME = "tmp-create-or-update-pull-request-action";

main();

async function main() {
  if (!process.env.GITHUB_TOKEN) {
    core.setFailed(
      `GITHUB_TOKEN is not configured. Make sure you made it available to your action
  
  uses: gr2m/create-or-update-pull-request-with-local-changes-action@master
  env:
    GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}`
    );
    return;
  }

  if (!process.env.GITHUB_REPOSITORY) {
    core.setFailed(
      'GITHUB_REPOSITORY missing, must be set to "<repo owner>/<repo name>"'
    );
    return;
  }
  if (!process.env.GITHUB_REF) {
    core.setFailed(
      "GITHUB_REF missing, must be set to the repository's default branch"
    );
    return;
  }

  try {
    const inputs = {
      title: core.getInput("title"),
      body: core.getInput("body"),
      branch: core.getInput("branch").replace(/^refs\/heads\//, ""),
      path: core.getInput("path"),
      commitMessage: core.getInput("commit-message"),
      author: core.getInput("author")
    };

    core.debug(`Inputs: ${inspect(inputs)}`);

    const {
      data: { default_branch }
    } = await request(`GET /repos/${process.env.GITHUB_REPOSITORY}`, {
      headers: {
        authorization: `token ${process.env.GITHUB_TOKEN}`
      }
    });
    const DEFAULT_BRANCH = default_branch;
    core.debug(`DEFAULT_BRANCH: ${DEFAULT_BRANCH}`);

    const { hasChanges } = await getLocalChanges(inputs.path);

    if (!hasChanges) {
      if (inputs.path) {
        core.info(`No local changes matching "${inputs.path}"`);
      } else {
        core.info("No local changes");
      }
      process.exit(0); // there is currently no neutral exit code
    }

    core.debug(`Local changes found`);

    await runShellCommand(`git checkout -b "${TEMPORARY_BRANCH_NAME}"`);

    const gitUser = await getGitUser();
    if (gitUser) {
      core.debug(`Git User already configured as: ${inspect(gitUser)}`);
    } else {
      const matches = inputs.author.match(/^([^<]+)\s*<([^>]+)>$/);
      assert(
        matches,
        `The "author" input "${inputs.author}" does conform to the "Name <email@domain.test>" format`
      );
      const [, name, email] = matches;

      await setGitUser({
        name,
        email
      });
    }

    if (inputs.path) {
      core.debug(`Committing local changes matching "${inputs.path}"`);
      await runShellCommand(`git add "${inputs.path}"`);
    } else {
      core.debug(`Committing all local changes`);
      await runShellCommand("git add .");
    }

    await runShellCommand(
      `git commit -m "${inputs.commitMessage}" --author "${inputs.author}"`
    );

    const currentBranch = await runShellCommand(
      `git rev-parse --abbrev-ref HEAD`
    );

    if (currentBranch === DEFAULT_BRANCH) {
      core.info(`Already in basen branch "${branch}".`);
    } else {
      core.debug(`rebase all local changes on base branch`);
      await runShellCommand(
        `git fetch https://x-access-token:${process.env.GITHUB_TOKEN}@github.com/${process.env.GITHUB_REPOSITORY}.git ${DEFAULT_BRANCH}:${DEFAULT_BRANCH}`
      );
      await runShellCommand(`git stash --include-untracked`);
      await runShellCommand(`git rebase -X theirs "${DEFAULT_BRANCH}"`);
    }

    core.debug(`Try to fetch and checkout remote branch "${inputs.branch}"`);
    const remoteBranchExists = await checkOutRemoteBranch(inputs.branch);

    core.debug(`Pushing local changes`);
    await runShellCommand(
      `git push -f https://x-access-token:${process.env.GITHUB_TOKEN}@github.com/${process.env.GITHUB_REPOSITORY}.git HEAD:refs/heads/${inputs.branch}`
    );

    if (remoteBranchExists) {
      core.info(`Existing pull request for "${inputs.branch}" updated`);
      return;
    }

    core.debug(`Creating pull request`);
    const {
      data: { html_url }
    } = await request(`POST /repos/${process.env.GITHUB_REPOSITORY}/pulls`, {
      headers: {
        authorization: `token ${process.env.GITHUB_TOKEN}`
      },
      title: inputs.title,
      body: inputs.body,
      head: inputs.branch,
      base: DEFAULT_BRANCH
    });

    core.info(`Pull request created: ${html_url}`);
    await runShellCommand(`git stash pop || true`);
  } catch (error) {
    core.debug(inspect(error));
    core.setFailed(error.message);
  }
}

async function getLocalChanges(path) {
  const output = await runShellCommand(`git status ${path || "*"}`);

  if (/Your branch is up to date/.test(output)) {
    return;
  }

  const hasUncommitedChanges = /(Changes to be committed|Changes not staged|Untracked files)/.test(
    output
  );

  return {
    hasUncommitedChanges,
    hasChanges: hasUncommitedChanges
  };
}

async function getGitUser() {
  try {
    const name = await runShellCommand("git config --get user.name");
    const email = await runShellCommand("git config --get user.email");

    return {
      name,
      email
    };
  } catch (error) {
    return;
  }
}

async function setGitUser({ name, email }) {
  core.debug(`Configuring user.name as "${name}"`);
  await runShellCommand(`git config --global user.name "${name}"`);

  core.debug(`Configuring user.email as "${email}"`);
  await runShellCommand(`git config --global user.email "${email}"`);
}

async function checkOutRemoteBranch(branch) {
  try {
    const currentBranch = await runShellCommand(
      `git rev-parse --abbrev-ref HEAD`
    );

    if (currentBranch === branch) {
      core.info(`Already in "${branch}".`);
      return true;
    }

    core.debug(`fetching "${branch}" branch from remote`);
    await runShellCommand(
      `git fetch https://x-access-token:${process.env.GITHUB_TOKEN}@github.com/${process.env.GITHUB_REPOSITORY}.git ${branch}:${branch}`
    );

    await runShellCommand(`git branch`);

    core.debug(`Checking out "${branch}" branch locally`);
    await runShellCommand(`git checkout ${branch}`);
    core.info(`Remote branch "${branch}" checked out locally.`);

    await runShellCommand(`git rebase -X theirs "${TEMPORARY_BRANCH_NAME}"`);

    return true;
  } catch (error) {
    core.info(`Branch "${branch}" does not yet exist on remote.`);
    await runShellCommand(`git checkout -b ${branch}`);
    return false;
  }
}

async function runShellCommand(commandString) {
  core.debug(`$ ${commandString}`);
  try {
    const { stdout, stderr } = await command(commandString, { shell: true });
    const output = [stdout, stderr].filter(Boolean).join("\n");
    core.debug(output);
    return output;
  } catch (error) {
    core.debug(inspect(error));
    throw error;
  }
}
