# Publish to GitHub (First Public Release)

## 1) Create/verify remote

```bash
git remote -v
```

If missing:

```bash
git remote add origin git@github.com:<your-user>/<your-repo>.git
```

## 2) Replace required placeholders

- `CODE_OF_CONDUCT.md`: `REPLACE_WITH_YOUR_COMMUNITY_EMAIL`
- `SECURITY.md`: `REPLACE_WITH_YOUR_SECURITY_EMAIL`
- `.github/ISSUE_TEMPLATE/config.yml`: security contact email

## 3) Run local validation

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run oss:preflight
```

## 4) Commit and push

```bash
git checkout -b chore/oss-publish
git add -A
git commit -m "chore: prepare public open-source release"
git push -u origin HEAD
```

## 5) Open PR and merge

- Ensure CI is green.
- Merge into `main`.

## 6) Tag first release

```bash
git checkout main
git pull
git tag v1.0.0
git push origin v1.0.0
```

Create a GitHub Release from `v1.0.0` using notes from `CHANGELOG.md`.
