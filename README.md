# Create or Update Pull Request action

> A GitHub Action to create or update a pull request based on local changes

## Usage

Minimal workflow example

```yml
name: Nightly update
on:
  schedule:
    # https://crontab.guru/every-night-at-midnight
    - cron: "0 0 * * *"

jobs:
  update_routes:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
        with:
          persist-credentials: false
      - run: "date > datetime.txt" # create or update a test.txt file
      - uses: gr2m/create-or-update-pull-request-action@v1
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

`persist-credentials: false` is crucial otherwise Git push is performed with `github.token` and not the token you configure using the `env: GITHUB_TOKEN`.

Customizations

```yml
uses: gr2m/create-or-update-pull-request-action@v1
env:
  GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
with:
  title: "My pull request title"
  body: "My pull request body"
  branch: "my-pull-request-base-branch"
  path: "lib/"
  commit-message: "My commit message for uncommitted changes in lib/ folder"
  author: "Lorem J. Ipsum <lorem@example.com>"
  labels: label1, label2
  assignees: user1, user2
  auto-merge: squash
```

**Note:** `auto-merge` is optional. It can be set to `merge`, `squash`, or `rebase`. If [auto-merging](https://docs.github.com/en/github/collaborating-with-pull-requests/incorporating-changes-from-a-pull-request/automatically-merging-a-pull-request) is disabled in the repository, a warning will be logged, but the action will not fail.

To create multiple commits for different paths, use the action multiple times

```yml
- uses: gr2m/create-or-update-pull-request-action@v1
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
  with:
    title: "My pull request title"
    body: "My pull request body"
    branch: "my-pull-request-base-branch"
    author: "Lorem J. Ipsum <lorem@example.com>"
    path: "cache/"
    commit-message: "build: cache"
- uses: gr2m/create-or-update-pull-request-action@v1
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
  with:
    branch: "my-pull-request-base-branch"
    author: "Lorem J. Ipsum <lorem@example.com>"
    path: "data/"
    commit-message: "feat: data updated"
```

## Debugging

To see additional debug logs, create a secret with the name: `ACTIONS_STEP_DEBUG` and value `true`. There is no need to pass it as `env` to steps, it will work globally.

## How it works

The actions checks for local changes which can be

1. Uncommitted changes such as created, updated or deleted files as shown by `git status`
2. Local commits

If there are none, the action concludes with the "neutral" status

If there are changes, it does the following

1. Sets `user.name` and `user.email` with `git config --global` based on the `author` input, unless it has been already set before.
2. Looks for local changes with `git status`.
3. Adds a new commit using the `commit-message` input if there are uncommitted changes.
4. Pushes the local changes to remote using the branch configured in the `branch` input.
5. Creates a pull request using the `title` and `body` inputs. If a pull request exists for the branch, it's checked out locally, rebased with `-XTheirs` and pushed with `--force` to update the pull request with the new changes.

The actions outputs following properties:

 - `pull-request-number` - number of created/updated PR. Not set if result is `unchanged`.
 - `result` - `created`, `updated` or `unchanged` based if the PR was created, updated or if there were no local changes.

The action is written in JavaScript. [Learn how to create your own](https://help.github.com/en/articles/creating-a-javascript-action).

## Who is using it

- [@octokit/routes](https://github.com/octokit/routes/blob/master/.github/workflows/update.yml)
- [@octokit/rest.js](https://github.com/octokit/rest.js/blob/master/.github/workflows/update-rest-endpoint-methods.yml)
- [@sinchang/cn-starbucks-stores-data](https://github.com/sinchang/cn-starbucks-stores-data/blob/master/.github/workflows/update.yml)
- [`ergebnis/composer-normalize`](https://github.com/ergebnis/composer-normalize/blob/69ec6fd9a87cbb16badf2a988f4372221592b05e/.github/workflows/schema.yml#L25-L38)
- [nodejs/node](https://github.com/nodejs/node/blob/master/.github/workflows/license-builder.yml)

Please send a pull request to add yours :)

## Credit

Inspired by the [Create Pull Request action](https://github.com/peter-evans/create-pull-request) by [@peter-evans](https://github.com/peter-evans)

## License

[MIT](LICENSE)
