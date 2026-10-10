# Panel Fox

Manga page editor. Draw panels, letter speech bubbles, and read the page.

## Run

```bash
npm install
npm run dev
```

Open the local dev URL Vite prints.

## Do not break

- Speech-bubble text stays inside the bubble, centered, and wraps on whole words.
- Font size must not jump while typing or after you click away. Balloons are sized around the words by `src/lib/manga/fit.ts`; never scale the type to fit.
- Read mode zoom must redraw the page sharp, not stretch a small bitmap.
- Do not put Windows, Mac, or iPhone installer zips back into `public/` or the web build. They are too large to publish.
- Wheel / button nudges on a balloon stay a local draft until the input goes quiet; do not write to the store per tick.

See `CHANGELOG.md` for the editing-experience pass.
