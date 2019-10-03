const assert = require("assert");
const { inspect } = require("util");

const { command } = require("execa");
const core = require("@actions/core");
const { request } = require("@octokit/request");

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
      branch: core.getInput("branch"),
      commitMessage: core.getInput("commit-message"),
      commits: core.getInput("commits"),
      author: core.getInput("author")
    };

    core.debug(`Inputs: ${inspect(inputs)}`);

    if (commits.commits) {
      const allCommitsValid =
        Array.isArray(commits.commits) &&
        commits.commits.every(
          commit =>
            typeof commit.path === "string" &&
            typeof commit.message === "string"
        );
      if (!allCommitsValid) {
        core.setFailed(
          "`commit` input must be an array of objects, each object must have a path and a message key"
        );
        return;
      }
    }

    const { hasChanges, hasUncommitedChanges } = await getLocalChanges();

    if (!hasChanges) {
      core.info("No local changes");
      process.exit(0); // there is currently no neutral exit code
    }

    if (hasUncommitedChanges) {
      core.debug(`Uncommited changes found`);

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

      if (inputs.commits) {
        core.debug(`Committing local changes using specific commits and paths`);
        for (const { path, message } of inputs.commits) {
          await command(`git add "${path}"`, { shell: true });
          await command(
            `git commit -m "${message}" --author "${inputs.author}"`,
            { shell: true }
          );
        }
      } else {
        core.debug(`Committing all local changes`);

        await command("git add .", { shell: true });
        await command(
          `git commit -a -m "${inputs.commitMessage}" --author "${inputs.author}"`,
          { shell: true }
        );
      }
    } else {
      core.debug(`No uncommited changes found`);
    }

    core.debug(`Try to fetch and checkout remote branch`);
    const remoteBranchExists = await checkOutRemoteBranch(inputs.branch);

    core.debug(`Pushing local changes`);
    const { stdout: pushStdOut, stderr: pushStdErr } = await command(
      `git push -f https://x-access-token:${process.env.GITHUB_TOKEN}@github.com/${process.env.GITHUB_REPOSITORY}.git HEAD:refs/heads/${inputs.branch}`,
      { shell: true }
    );

    // no idea why the `git push` output goes into stderr. Checking in both just in case.
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
      base: process.env.GITHUB_REF.substr("refs/heads/".length)
    });

    core.info(`Pull request created: ${html_url}`);
  } catch (error) {
    core.debug(inspect(error));
    core.setFailed(error.message);
  }
}

async function getLocalChanges() {
  const { stdout } = await command("git status", { shell: true });

  if (/Your branch is up to date/.test(stdout)) {
    return;
  }

  const hasCommits = /Your branch is ahead/.test(stdout);
  const hasUncommitedChanges = /(Changes to be committed|Changes not staged|Untracked files)/.test(
    stdout
  );

  return {
    hasCommits,
    hasUncommitedChanges,
    hasChanges: hasCommits || hasUncommitedChanges
  };
}

async function getGitUser() {
  try {
    const { stdout: name } = await command("git config --get user.name", {
      shell: true
    });
    const { stdout: email } = await command("git config --get user.email", {
      shell: true
    });

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
  await command(`git config --global user.name "${name}"`, { shell: true });

  core.debug(`Configuring user.email as "${email}"`);
  await command(`git config --global user.email "${email}"`, { shell: true });
}

async function checkOutRemoteBranch(branch) {
  try {
    await command(
      `git fetch https://x-access-token:${process.env.GITHUB_TOKEN}@github.com/${process.env.GITHUB_REPOSITORY}.git ${branch}:${branch}`,
      { shell: true }
    );
    await command(`git checkout ${branch}`, { shell: true });
    core.info(`Remote branch "${branch}" checked out locally.`);
    await command(`git rebase -Xtheirs -`, { shell: true });
    return true;
  } catch (error) {
    core.info(`Branch "${branch}" does not yet exist on remote.`);
    return false;
  }
}
