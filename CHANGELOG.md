# Changelog

## Editing experience pass

Each area below was changed on its own, run in Chromium, and checked on
screen (typing, resizing, zooming, undo, reload) before the next one.

### 1. Speech bubble lettering (fixed)

- **New `src/lib/manga/fit.ts`.** Balloons are now sized from real text
  metrics (canvas `measureText` with the same font the page renders) instead
  of character-count guesses. Words wrap on whole words, the text block sits
  centred inside the balloon's text frame (the inner ellipse for ovals and
  clouds, the padded box for captions), and the balloon grows or reshapes
  around the words.
- **Type never changes size on its own.** The old shrink-to-fit pass
  (`--fit-scale`) that scaled the lettering down after you clicked away, and
  the textarea "grow" effect that fought with it while typing, are gone. The
  font size you pick is the font size you get, while typing and after blur.
- **Calm growth while typing.** The balloon keeps its width while the words
  still fit well and adds lines; it only reshapes when the proportions drift.
  A balloon you resized by hand keeps that width and only grows taller.
- **Resize can't squeeze words out.** Dragging a handle stops at the smallest
  box that still holds every whole word (`letterMinBox`).
- Font size changes (A−/A+, the size field, the wheel) refit the balloon.
- The script panel and "Fit" button use the same measured fit.
- Canvas export was checked against the screen: same wrap, same placement.

### 2. Smooth dragging, resizing and font size (fixed)

- Wheel and A−/A+ nudges (font size, sticker scale, rotation) are now a local
  draft like a drag, committed as one history step when the input goes quiet.
  Before, every tick wrote to the store and re-rendered the whole studio
  (50–90 ms long tasks per wheel notch in the profiler; now none).
- `Bubble`, `PageThumb`, the menubar and the insert palettes are memoized so
  only the balloon being edited re-renders.
- Snap-guide updates during a drag are deduplicated so the page doesn't
  re-render on every pointer move.
- Panel boxes keep their identity across lettering edits.

### 3. Read mode zoom (verified, unchanged)

Read mode already re-lays the page out at the new size (`--read-zoom` drives
real width/height, not a CSS scale), so text and panel art stay sharp at
400%. Wheel/pinch zoom to the pointer, drag to pan, double-click to zoom in
and out, and `+` `−` `0` keys all work; measured at a steady 60 fps.

### 4. Autosave, undo, redo (verified, improved)

- Session state still persists to IndexedDB and survives a reload; undo and
  redo work for typing, moving, resizing and font changes.
- **New:** the project is now written about 2.5 s after your last edit as
  well as on the 30 s interval and when the tab is hidden, so the header
  stops saying "unsaved" almost immediately.

### 5. Collapsible panels (verified, improved)

Clinic icons, Sound effects and Emotion marks still fold. **New:** each fold
remembers whether you left it open.

### 6. New features

- **Double-click to letter.** Double-click any panel and a speech balloon
  drops at that spot, already open for typing.
- **Letterer's typography.** As you type, `...` becomes `…`, `--` becomes an
  em dash, ` - ` becomes an en dash, and straight quotes curl (`"hi"` →
  `“hi”`). The caret stays where you are, even mid-sentence.
  (`src/lib/manga/typography.ts`, with unit tests.)
- **Shift-resize keeps proportions.** Hold Shift while dragging a balloon
  handle to keep its shape; snapping is paused while Shift is held.
- **Quick autosave** and **remembered folds** as above.

### Tests

`npm test` now also runs `src/lib/manga/typography.test.ts`. The 12 failing
tests under `scripts/` (platform share-card / app-env checks) fail identically
on the original source and are unrelated to the editor.
