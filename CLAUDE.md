# Project Rules

- Build release zips from the current project folder only: `/Users/curtisyan/Desktop/project/boss-job-share-extension`.
- After any code fix or behavior change, bump the extension version in `manifest.json` before building a new importable package.
- Use the next patch version for fixes. For example, after `0.4.2`, the next fixed package must be `0.4.3`.
- Before handing off a package, run basic syntax checks and rebuild the zip so the importable extension matches the current source.
