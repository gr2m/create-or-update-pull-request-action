# 🚧 THIS IS WORK IN PROGRESS [#1](https://github.com/gr2m/create-or-update-pull-request-action)

# Create or Update Pull Request with local changes

> A GitHub Action to create or update a pull request based on local changes

## Usage

Minimal workflow example

```yml
name: Update REST API endpoint methods
on:
  repository_dispatch:
    types: [octokit-routes-release]

jobs:
  update_routes:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@master
      - run: "date > test.txt" # create or update a test.txt file
      - uses: gr2m/create-or-update-pull-request-action@master
        with:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Customizations

```yml
uses: gr2m/create-or-update-pull-request-action@master
with:
  GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
with:
  title: "My pull request title"
  body: "My pull request body"
  branch: "my-pull-request-base-branch"
  commit-message: "My commit message for uncommited changes"
  author: "Lorem J. Ipsum <lorem@example.com>"
```

## How it works

The actions checks for local changes which can be

1. Uncommitted changes such as created, updated or deleted files as shown by `git status`
2. Local commits

If there are none, the action concludes with the "neutral" status

If there are changes, it does the following

1. Set `user.name` and `user.email` with `git config --global` based on the `author` input, unless it has been already set before.
2. It looks for local changes with `git status`.
3. If there are uncommited changes, it adds a new commit using the `commit-message` input.
4. It pushes the local changes to remote using the branch configured in the `branch` input.
5. It creates a pull request using the `title` and `body` inputs.

The action is written in JavaScript. [Learn how to create your own](https://help.github.com/en/articles/creating-a-javascript-action).

## Credit

Inspired by the [Create Pull Request action](https://github.com/peter-evans/create-pull-request) by [@peter-evans](https://github.com/peter-evans)

## License

[MIT](LICENSE)
