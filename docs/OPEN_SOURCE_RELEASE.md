# Open Source Release Checklist

Use this checklist before publishing or tagging a release.

## 1) Repository Hygiene

- [ ] `.env` and secret files are ignored and not committed
- [ ] Runtime folders are not committed (`store/`, `logs/`, auth/session artifacts)
- [ ] README quick start works from a clean clone
- [ ] `LICENSE`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md` are present
- [ ] Issue/PR templates are present under `.github/`

## 2) Technical Validation

- [ ] `npm ci`
- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `npm run build`

## 3) Docs Validation

- [ ] Main features are documented in `README.md`
- [ ] Security model links to `docs/SECURITY.md`
- [ ] Contribution expectations are clear (core vs skills)

## 4) Release Metadata

- [ ] Version bumped in `package.json`
- [ ] Changelog entry added (if you keep a changelog)
- [ ] Release notes draft prepared with:
  - What changed
  - Breaking changes
  - Migration/setup notes

## 5) Publish Steps (GitHub)

```bash
git checkout -b chore/oss-packaging
git add -A
git commit -m "chore: prepare open-source project scaffolding"
git push -u origin HEAD
```

Then open a PR and verify CI passes.

When ready to release:

```bash
git checkout main
git pull
git tag vX.Y.Z
git push origin vX.Y.Z
```

Create a GitHub Release from the tag and paste release notes.
