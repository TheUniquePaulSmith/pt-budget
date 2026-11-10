# ptbudget app: coming-soon placeholder

`main` is the production branch behind **app.ptbudget.com**. Until the first release it holds only this static placeholder. The app itself is developed on `devel/latest`.

## Build

```bash
npm run build     # writes dist/: index.html, 404.html, favicons, _headers
npx serve dist    # look at it locally
```

No dependencies. The contract is the same as the app's (`npm run build` writes a static site to `dist/`), so the Cloudflare worker for app.ptbudget.com keeps its build settings when the app replaces this branch.

## Version footer

The page footer shows what was built, using the rule the app follows:

| Build | Footer |
|---|---|
| `main`, commit carries a release tag (`vX.Y.Z`) | the tag, e.g. `v1.0.0` |
| anything else | `build <short commit hash>` |
| `APP_VERSION` build variable set | that value, as is |

CI checkouts are usually shallow and carry no tags, so on CI the build also asks the remote (`git ls-remote --tags origin`) for a tag at the commit. The tag has to exist when the build starts: push it together with the branch (`git push origin main v1.0.0`), or re-run the build after tagging. The build log prints the branch, commit, and where the version came from.

## Editing the page

`site/index.html` is self-contained (inline CSS and JavaScript, no external requests). The winged-money logo, the favicons and the pixel galaxy come from the app (`src/lib/pixelMoneySprite.json`, `src/app/icon.svg`, `src/lib/pixelGalaxy.ts` on `devel/latest`). `scripts/build.mjs` copies `site/` to `dist/`, stamps the version into the `<!--version-->` marker and writes the same page as `404.html`.

`site/_headers` asks search engines not to index the placeholder (`X-Robots-Tag: noindex`); it goes away with this branch's content at the first release.
