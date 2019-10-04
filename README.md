# Create or Update Pull Request with local changes

> A GitHub Action to create or update a pull request based on local changes

## Usage

Minimal workflow example

```yml
Name: Nightly update
on:
  schedule:
    # https://crontab.guru/every-night-at-midnight
    - cron: "0 0 * * *"

jobs:
  update_routes:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@master
      - run: "date > datetime.txt" # create or update a test.txt file
      - uses: gr2m/create-or-update-pull-request-action@v1.x
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Customizations

```yml
uses: gr2m/create-or-update-pull-request-action@v1.x
env:
  GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
with:
  title: "My pull request title"
  body: "My pull request body"
  branch: "my-pull-request-base-branch"
  path: "lib/"
  commit-message: "My commit message for uncommited changes in lib/ folder"
  author: "Lorem J. Ipsum <lorem@example.com>"
```

To create multiple commits for different paths, use the action multiple times

```yml
- uses: gr2m/create-or-update-pull-request-action@v1.x
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
  with:
    title: "My pull request title"
    body: "My pull request body"
    branch: "my-pull-request-base-branch"
    author: "Lorem J. Ipsum <lorem@example.com>"
    path: "cache/"
    commit-message: "build: cache"
- uses: gr2m/create-or-update-pull-request-action@v1.x
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
  with:
    branch: "my-pull-request-base-branch"
    author: "Lorem J. Ipsum <lorem@example.com>"
    path: "data/"
    commit-message: "feat: data updated"
```

## How it works

The actions checks for local changes which can be

1. Uncommitted changes such as created, updated or deleted files as shown by `git status`
2. Local commits

If there are none, the action concludes with the "neutral" status

If there are changes, it does the following

1. Sets `user.name` and `user.email` with `git config --global` based on the `author` input, unless it has been already set before.
2. Looks for local changes with `git status`.
3. Adds a new commit using the `commit-message` input if there are uncommited changes.
4. Pushes the local changes to remote using the branch configured in the `branch` input.
5. Creates a pull request using the `title` and `body` inputs. If a pull request exists for the branch, it's checkoud out locally, rebased with `-XTheirs` and pushed with `--force` to update the pull request with the new changes.

The action is written in JavaScript. [Learn how to create your own](https://help.github.com/en/articles/creating-a-javascript-action).

## Credit

Inspired by the [Create Pull Request action](https://github.com/peter-evans/create-pull-request) by [@peter-evans](https://github.com/peter-evans)

## License

[MIT](LICENSE)
