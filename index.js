const assert = require("assert");
const { inspect } = require("util");

const { command } = require("execa");
const core = require("@actions/core");
const { Octokit } = require("@octokit/core");

const TEMPORARY_BRANCH_NAME = `tmp-create-or-update-pull-request-action-${Math.random()
  .toString(36)
  .substr(2)}`;

main();

async function main() {
  if (!process.env.GITHUB_TOKEN) {
    core.setFailed(
      `GITHUB_TOKEN is not configured. Make sure you made it available to your action

  uses: gr2m/create-or-update-pull-request-action@master
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

  const octokit = new Octokit({
    auth: process.env.GITHUB_TOKEN,
  });


  try {
    const inputs = {
      title: core.getInput("title"),
      body: core.getInput("body"),
      branch: core.getInput("branch").replace(/^refs\/heads\//, ""),
      pathToCdTo: core.getInput("path-to-cd-to"),
      repository: core.getInput("repository"),
      commitMessage: core.getInput("commit-message"),
      author: core.getInput("author"),
      labels: core.getInput("labels"),
      assignees: core.getInput("assignees"),
      reviewers: core.getInput("reviewers"),
      team_reviewers: core.getInput("team_reviewers"),
      autoMerge: core.getInput("auto-merge"),
      updatePRTitleAndBody: core.getInput("update-pull-request-title-and-body"),
    };

    core.debug(`Inputs: ${inspect(inputs)}`);

    let [owner, repo] = process.env.GITHUB_REPOSITORY.split("/");
    if (inputs.repository) {
      [owner, repo] = inputs.repository.split("/");
    }

    if (
      inputs.autoMerge &&
      !["merge", "squash", "rebase"].includes(inputs.autoMerge)
    ) {
      core.setFailed(
        `auto-merge is set to "${inputs.autoMerge}", but must be one of "merge", "squash", "rebase"`
      );
      process.exit(1);
    }

    const {
      data: { default_branch },
    } = await octokit.request(`GET /repos/{owner}/{repo}`, {
      owner,
      repo,
    });
    const DEFAULT_BRANCH = default_branch;
    core.debug(`DEFAULT_BRANCH: ${DEFAULT_BRANCH}`);

    if (inputs.pathToCdTo) {
      core.debug(`Changing directory to ${inputs.pathToCdTo}`);
      process.chdir(inputs.pathToCdTo);
    }

    const { hasChanges } = await getLocalChanges();

    if (!hasChanges) {
      core.info("No local changes");
      core.setOutput("result", "unchanged");
      process.exit(0); // there is currently no neutral exit code
    }

    core.debug(`Local changes found`);

    await runShellCommand(`git checkout -b '${TEMPORARY_BRANCH_NAME}'`);

    const gitUser = await getGitUser();
    if (gitUser) {
      core.debug(`Git User already configured as: ${inspect(gitUser)}`);
    } else {
      const matches = inputs.author.match(/^([^<]+)\s*<([^>]+)>$/);
      assert(
        matches,
        `The "author" input "${inputs.author}" does not conform to the "Name <email@domain.test>" format`
      );
      const [, name, email] = matches;

      await setGitUser({
        name,
        email,
      });
    }

    core.debug(`Committing all local changes`);
    await runShellCommand("git add .");

    await runShellCommand(
      `git commit -m '${inputs.commitMessage}' --author '${inputs.author}'`
    );

    const currentBranch = await runShellCommand(
      `git rev-parse --abbrev-ref HEAD`
    );

    if (currentBranch === DEFAULT_BRANCH) {
      core.info(`Already in base branch "${currentBranch}".`);
    } else {
      core.debug(`rebase all local changes on base branch`);
      await runShellCommand(
        `git fetch https://x-access-token:${process.env.GITHUB_TOKEN}@github.com/${owner}/${repo}.git ${DEFAULT_BRANCH}:${DEFAULT_BRANCH}`
      );
      await runShellCommand(`git stash --include-untracked`);
      await runShellCommand(`git rebase -X theirs '${DEFAULT_BRANCH}'`);
    }

    core.debug(`Try to fetch and checkout remote branch "${inputs.branch}"`);
    const remoteBranchExists = await checkOutRemoteBranch(inputs.branch);

    core.debug(`Pushing local changes`);
    await runShellCommand(
      `git push -f https://x-access-token:${process.env.GITHUB_TOKEN}@github.com/${owner}/${repo}.git HEAD:refs/heads/${inputs.branch}`
    );

    if (remoteBranchExists) {
      const q = `head:${inputs.branch} type:pr is:open repo:${owner}/${repo}`;
      const { data } = await octokit.request("GET /search/issues", {
        q,
      });

      if (data.total_count > 0) {
        const prInfo = data.items[0]; // Assuming there is only one PR for given branch

        core.setOutput(`pull-request-number`, prInfo.number);
        core.setOutput(`result`, `updated`);
        core.info(
          `Existing pull request for branch "${inputs.branch}" updated: ${prInfo.html_url}`
        );
        if (inputs.updatePRTitleAndBody === "false") return;
        await octokit.request(`POST /repos/{owner}/{repo}/pulls/{number}`, {
          owner,
          repo,
          number: prInfo.number,
          title: inputs.title,
          body: inputs.body,
        });
        core.info(`PR title and body are updated`);
        return;
      }
    }

    core.debug(`Creating pull request`);
    const {
      data: { html_url, number, node_id },
    } = await octokit.request(`POST /repos/{owner}/{repo}/pulls`, {
      owner,
      repo,
      title: inputs.title,
      body: inputs.body,
      head: inputs.branch,
      base: DEFAULT_BRANCH,
    });

    core.info(`Pull request created: ${html_url} (#${number})`);

    core.setOutput(`pull-request-number`, number);
    core.setOutput(`result`, `created`);

    if (inputs.labels) {
      core.debug(`Adding labels: ${inputs.labels}`);
      const labels = inputs.labels.trim().split(/\s*,\s*/);
      const { data } = await octokit.request(
        `POST /repos/{owner}/{repo}/issues/{issue_number}/labels`,
        {
          owner,
          repo,
          issue_number: number,
          labels,
        }
      );
      core.info(`Labels added: ${labels.join(", ")}`);
      core.debug(inspect(data));
    }

    if (inputs.assignees) {
      core.debug(`Adding assignees: ${inputs.assignees}`);
      const assignees = inputs.assignees.trim().split(/\s*,\s*/);
      const { data } = await octokit.request(
        `POST /repos/{owner}/{repo}/issues/{issue_number}/assignees`,
        {
          owner,
          repo,
          issue_number: number,
          assignees,
        }
      );
      core.info(`Assignees added: ${assignees.join(", ")}`);
      core.debug(inspect(data));
    }

    if (inputs.reviewers || inputs.team_reviewers) {
      let params = {
        owner,
        repo,
        pull_number: number
      }
      let reviewers = null;
      let team_reviewers = null;

      if (inputs.reviewers) {
        core.debug(`Adding reviewers: ${inputs.reviewers}`)
        reviewers = (inputs.reviewers || "").trim().split(/\s*,\s*/);

        params = {
          ...params,
          reviewers
        }
      };

      if (inputs.team_reviewers) {
        core.debug(`Adding team reviewers: ${inputs.team_reviewers}`)
        team_reviewers = (inputs.team_reviewers || "").trim().split(/\s*,\s*/);

        params = {
          ...params,
          team_reviewers
        }
      };

      const { data } = await octokit.request(
        `POST /repos/{owner}/{repo}/pulls/{pull_number}/requested_reviewers`,
        params
      );

      if (reviewers) {
        core.info(`Reviewers added: ${reviewers.join(", ")}`);
      }

      if (team_reviewers) {
        core.info(`Team reviewers added: ${team_reviewers.join(", ")}`);
      }

      core.debug(inspect(data));
    }

    if (inputs.autoMerge) {
      const query = `
        mutation($pullRequestId: ID!, $mergeMethod: PullRequestMergeMethod!, $commitHeadline: String!) {
          enablePullRequestAutoMerge(input: {pullRequestId: $pullRequestId, mergeMethod: $mergeMethod, commitHeadline: $commitHeadline}) {
            actor {
              login
            }
          }
        }
      `;
      try {
        const result = await octokit.graphql(query, {
          pullRequestId: node_id,
          mergeMethod: inputs.autoMerge.toUpperCase(),
          commitHeadline: inputs.title,
        });
        core.info(`Auto merge enabled`);
        core.debug(inspect(result));
      } catch (error) {
        core.warning(
          `Auto merge could not be enabled for the pull request. Make sure the feature is enabled in the repository settings`
        );
      }
    }

    await runShellCommand(`git stash pop || true`);
  } catch (error) {
    core.info(inspect(error));
    core.setFailed(error.message);
  }
}

async function getLocalChanges() {
  const output = await runShellCommand(`git status`);

  if (/nothing to commit, working tree clean/i.test(output)) {
    return {};
  }

  const hasUncommitedChanges =
    /(Changes to be committed|Changes not staged|Untracked files)/.test(output);

  return {
    hasUncommitedChanges,
    hasChanges: hasUncommitedChanges,
  };
}

async function getGitUser() {
  try {
    const name = await runShellCommand("git config --get user.name");
    const email = await runShellCommand("git config --get user.email");

    return {
      name,
      email,
    };
  } catch (error) {
    return;
  }
}

async function setGitUser({ name, email }) {
  core.debug(`Configuring user.name as "${name}"`);
  await runShellCommand(`git config --global user.name '${name}'`);

  core.debug(`Configuring user.email as "${email}"`);
  await runShellCommand(`git config --global user.email '${email}'`);
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
      `git fetch https://x-access-token:${process.env.GITHUB_TOKEN}@github.com/${owner}/${repo}.git ${branch}:${branch}`
    );

    await runShellCommand(`git branch`);

    core.debug(`Checking out "${branch}" branch locally`);
    await runShellCommand(`git checkout ${branch}`);
    core.info(`Remote branch "${branch}" checked out locally.`);

    try {
      await runShellCommand(
        `git cherry-pick --strategy recursive --strategy-option theirs ${TEMPORARY_BRANCH_NAME}`
      );
    } catch (error) {
      // https://github.com/gr2m/create-or-update-pull-request-action/issues/245
      if (/The previous cherry-pick is now empty/.test(error.stderr)) {
        await runShellCommand(`git cherry-pick --skip`);
      }
    }

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
