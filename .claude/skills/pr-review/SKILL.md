---
name: pr-review
description: Review a GitHub PR using GitHub Copilot CLI locally. No external API needed - uses your Copilot subscription.
---

# PR Review with GitHub Copilot CLI

This skill reviews a GitHub Pull Request using **GitHub Copilot CLI** directly on your Mac. No external API needed.

## Prerequisites

### 1. Install GitHub CLI

```bash
brew install gh
```

### 2. Enable Copilot

Make sure you have Copilot enabled:
```bash
gh copilot --version
```

### 3. Authenticate

```bash
gh auth login
```

## Usage

### Review a PR

```bash
# Review PR by number
/review-pr 123

# Review current branch PR
/review-pr
```

## How It Works

The script:
1. Gets the PR diff using `gh pr diff`
2. Sends it to `gh copilot` for review
3. Posts the review as a comment on the PR

## Implementation

Create `~/.claude/scripts/review-pr.sh`:

```bash
#!/bin/bash
set -e

PR_NUMBER="${1:-}"

if [ -z "$PR_NUMBER" ]; then
  PR_NUMBER=$(gh pr view --json number -q '.number' 2>/dev/null || echo "")
fi

if [ -z "$PR_NUMBER" ]; then
  echo "Error: No PR number provided"
  exit 1
fi

echo "Getting PR #$PR_NUMBER info..."

# Get PR details
PR_TITLE=$(gh pr view $PR_NUMBER --json title -q '.title')
PR_URL=$(gh pr view $PR_NUMBER --json url -q '.url')

echo "Getting PR diff..."

# Get diff (limit to 50k chars for Copilot)
PR_DIFF=$(gh pr diff $PR_NUMBER --patch | head -c 50000)

echo "Asking Copilot to review..."

# Use gh copilot to review
REVIEW=$(gh copilot suggest -t "You are a senior software engineer reviewing a pull request. Review the following diff and provide feedback about bugs, security issues, code quality, and suggestions. Be concise but specific. Use markdown format." -- \
  "Please review this PR diff:

**PR #$PR_NUMBER**: $PR_TITLE
**URL**: $PR_URL

\`\`\`diff
$PR_DIFF
\`\`\`

Provide a thorough code review." 2>&1)

# Post as PR comment
echo "$REVIEW" | gh pr comment $PR_NUMBER --body-file -

echo "Review posted to PR #$PR_NUMBER"
```

Make executable:
```bash
chmod +x ~/.claude/scripts/review-pr.sh
```

## Alternative: Using GitHub Copilot in VS Code

If you prefer, you can use the VS Code extension:

1. Open the PR in VS Code (with GitHub Pull Requests extension)
2. Use Copilot Chat: "@copilot review this PR"
3. Copy the review and post as comment

## Notes

- Uses your existing Copilot subscription (Pro/Business/Pro+)
- No additional API costs
- Runs locally on your Mac
- May take a moment to process large PRs
