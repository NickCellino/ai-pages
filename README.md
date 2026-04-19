# AI Pages

This repository hosts AI-generated static webpages with a simple GitHub and Vercel workflow.

## Repository Layout

- `index.html`: homepage listing published pages
- `pages/<slug>/index.html`: one static page per slug
- Optional page assets inside `pages/<slug>/`: `style.css`, `script.js`, `assets/`

## Adding a Page

1. Create a branch from `main`.
2. Add a new directory at `pages/<slug>/`.
3. Add `index.html` inside that directory.
4. Add optional supporting files only inside the same page directory.
5. Update `index.html` in the repo root to link to the new page.
6. Commit, push the branch, and open a pull request.

## Deployment Flow

- Push to `main`: Vercel creates a production deployment.
- Open or update a pull request: Vercel creates a preview deployment for that branch or PR.
- Each pull request gets its own preview URL so pages can be reviewed before merge.

## GitHub Workflow

Typical flow:

1. Create a feature branch.
2. Add or update files.
3. Push the branch to GitHub.
4. Open a pull request.
5. Review the Vercel preview deployment.
6. Merge to `main` to publish to production.

## Vercel Setup

This project is static and uses no framework or build step.

Expected Vercel settings:

- Framework Preset: `Other`
- Root Directory: `./`
- Build Command: none
- Output Directory: `./`

If GitHub is not fully connected through the CLI, finish setup in the Vercel dashboard:

1. Open the project in Vercel.
2. Connect the GitHub repository.
3. Confirm the production branch is `main`.
4. Ensure automatic deployments are enabled.

## Agent Notes

See `AGENTS.md` for the strict page creation and PR rules used by agents.
