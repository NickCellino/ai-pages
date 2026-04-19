# Agent Instructions

## Rules

- Put each project in `pages/<slug>/`
- Each project must have `index.html`
- A project may have additional HTML files, plus CSS, JS, and assets
- Treat each folder as a self-contained mini-site
- Use relative links like `./other.html`
- Keep all files for a project inside its own folder
- Do not depend on files from other project folders
- Update the root `index.html` to link to each new project
- Use a feature branch and open a PR
- Do not commit directly to `main`

## Prefer

- Plain HTML, CSS, and JavaScript
- Simple structure
- Minimal dependencies

## Avoid

- Frameworks
- Build steps
- Server-side code
- Unrelated refactors

## Example

```text
pages/quiz-app/
  index.html
  results.html
  style.css
  script.js
  assets/
```
