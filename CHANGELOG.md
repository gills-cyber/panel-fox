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

## Hand-drawn balloons

- **G-pen ink.** Balloon outlines are no longer a uniform stroked ellipse.
  `src/lib/manga/ink.ts` draws each outline as a filled ink ribbon whose
  width swells and thins like a nib under changing pressure, with a slow hand
  wobble, bowed tapering tails, scalloped thought clouds, uneven burst spikes,
  dabbed whisper dashes and a lighter inner ring for radio balloons. Captions
  stay ruler-straight with a hair of bow.
- **Same ink on screen and in export.** One generator produces path strings
  that the editor's SVG, the style thumbnails and the canvas export all paint,
  so PNG/PDF output matches the page. The pen width is compensated for the
  balloon box's proportions so it reads as one even pen however the balloon
  is stretched.
- **Each balloon has its own character, and keeps it.** The quirks come from
  a seed derived from the balloon's id, so nothing jitters between frames,
  undo/redo, or screen and export. Duplicating a balloon gives the copy its
  own hand.
- **Lettering untouched.** The text frame (`balloonEllipse` /
  `balloonTextFrame`) and the measured fit are unchanged; the ink's inner
  edge stays outside the text frame. `src/lib/manga/ink.test.ts` checks this
  for every style across 40 seeds and five box proportions, and checks that
  the output is deterministic.
- **Switchable.** View ▸ Hand-drawn Balloons (also in the inspector) turns the
  clean geometry back on; the choice is remembered and respected by export.
- `npm test` now runs the ink test; `scripts/ts-resolve.mjs` lets `node --test`
  import modules that use the `@/` alias.
- **Follow-up fixes.** The ink now grows outward only, so the inner edge
  never crosses the text frame however hard a balloon is squeezed; captions
  enclose their whole text frame on paper; thought clouds no longer draw a
  stray tail; and the hand-drawn setting is saved with the document, so a
  project opens with the ink it was lettered in. `ink.test.ts` covers the
  inner-edge rule for captions as well.

## macOS pass

The studio now reads as a native Mac document app. As before, each area was
changed on its own and checked on screen in light and dark appearance before
the next one. Lettering, dragging, resizing, zoom, autosave and undo/redo were
re-run after every step with the same Playwright scripts.

### Chrome and identity

- **Unified titlebar.** One glass strip holds the labeled toolbar items,
  hairline separators, the breadcrumb (project name › page) and a Read
  button as the accent item. Tooltips are light
  NSToolbar-style capsules that appear after 700 ms and show the shortcut in
  platform glyphs (⌘⇧Z on a Mac, Ctrl+Shift+Z elsewhere).
- **Document identity.** The window title follows the project name and
  shows "— Edited" while a change waits for autosave (it lingers a moment
  after the save, then fades); clicking the name renames
  it in place, and the little document-title menu offers Undo, Redo, Rename,
  Duplicate, Save a Copy… and Download Project File.
- **Floating layer.** Menus, popovers and context menus float in their own
  layer above the page with real glass, NSPopover arrows that point at their
  anchor, and clamping so nothing opens outside the window.
- **Inspector to AppKit spec.** Text fields, pop-up buttons, color wells, a
  sliding segmented control, switches, sliders with readouts, hairline
  groups and left-hand disclosure folds. `controls.tsx` exports the shared
  `Segmented` and `CheckRow` so the dialogs use the same parts.
- **Sheets and HUD.** Export, Save, Open and New are macOS sheets that drop
  from the toolbar, trap focus, close on Esc and confirm on Return; editor
  hotkeys are gated while one is open. Toasts are a HUD capsule at the
  bottom centre.
- **Reduced motion.** The animations in this pass are listed under
  `prefers-reduced-motion` and collapse to an instant change.

### Spotlight-style commands

- **⌘K (or ⌘⇧P) opens a command palette** over the studio. It lists every
  menubar verb, a "Go to" entry for each page, "Apply Layout" for each
  layout, and "Open" for each saved project, grouped like the menus with
  disabled verbs sorted last. Search matches whole-word prefixes (so `exp`
  finds Export but `xpo` does not), recents come first when the query is
  empty, and Return runs the command after the window has closed so the
  action never fights the closing animation.

### Mac keyboard set

- **⌘X / ⌘C / ⌘V carry balloons.** Cut and copy put the selected balloon on
  an internal clipboard and on the system clipboard: the balloon's words as
  plain text (so pasting into any text field inserts the words) and the
  balloon itself in an HTML flavour only this app reads, so it can be pasted
  into another project or another tab. Paste lands the copy offset by a few
  pixels when it would sit on the original. A cut balloon takes its script
  line with it; a pasted copy of a placed balloon gets its own line, like
  Duplicate.
- **Tab / ⇧Tab walk the balloons** once one is selected (and let go at the
  last one, so the keyboard can leave the page), PageDown / PageUp / Home /
  End walk the pages, Return starts editing the selected balloon, ⌥⌘P / I /
  J toggle the thumbnails, Format and Document panes, ⌥⌘0 is Actual Size.
- **Hotkey fixes found on the way.** The single-letter tool hotkeys (H, V,
  T, P) no longer fire when ⌘ is held, so ⌘V pastes instead of switching to
  the frame tool. ⌥ chords read the physical key (`e.code`) because macOS
  reports dead-key glyphs for ⌥-letters.

### Template chooser

- **New documents start from a Pages-style sheet** with Manga and Clinic
  brochure categories, template cards that cascade in, paper size and
  reading-direction controls, arrow-key navigation, Return and double-click
  to choose. The last choice is remembered. Read mode is left when a new
  document starts.

### Read mode motion

- **The reader rises over the editor and fades back** instead of swapping
  views; the editor stays mounted underneath (made `inert` and hidden from
  assistive tech), so returning to it is instant and the scroll position
  survives. Page turns push the old sheet out in the reading direction. Zoom
  steps and double-click ease to the new size while pinch and ⌘-wheel track
  the hand; the sheet owns the keys so a dialog on top is not driven by them.

### Trackpad zoom in the editor

- **Pinch and ⌘-wheel scale the sheets live under the fingers.** The motion
  is a GPU transform on the sheet container anchored at the pointer, so no
  layout runs during the gesture (the earlier per-frame relayout cost 50–66
  ms a frame on a large page). When the gesture settles, the zoom snaps to
  Fit or a preset within reach, lands once at the real layout size (so type
  and ink are redrawn sharp, never stretched), and restores the scroll so the
  point under the pointer does not move. Zoom steps and ⌘± / ⌘0 / ⌥⌘0 use
  the same motion.
- **Wide pages scroll from the left edge.** At numeric zoom the spread
  container hugs its sheets, so a page wider than the stage no longer loses
  its left half behind the centred layout.

### Review fixes

An adversarial review of the whole pass (four reviewers, each finding checked
by two independent skeptics against the running app and the original) found
nine regressions, all fixed and re-verified on screen:

- The inspector's Font pop-up leaked every key to the page: typeahead letters
  added or hid balloons, Backspace deleted the balloon being formatted, Esc
  deselected it. A widget that takes a key now keeps it from the page's
  hotkeys, and a pop-up list counts as a typing target.
- On Windows, AltGr arrives as Ctrl+Alt, so typing ś, ó or đ in a balloon
  opened the Save or Projects sheet. AltGr glyphs are never read as chords.
- Tab was a keyboard trap: it could never leave the page, and inside the
  format bar it switched balloons instead of moving between the buttons.
- ⌘C put the balloon on the system clipboard as raw JSON, so the next paste
  into a text field inserted the JSON. See the keyboard set above.
- ⌘X / ⌘V of a scripted balloon orphaned its script line.
- In the Projects sheet, Esc inside the rename field closed the whole sheet
  instead of cancelling the rename (Esc also backs out of a delete
  confirmation first now).
- On a two-page spread with an empty verso, zoom steps overshot and snapped
  and a pinch settled on the wrong size, because the placeholder was taken
  as the reference sheet and did not follow the zoom.
- Repeated zoom steps (a held ⌘= or quick clicks on +) were swallowed every
  other press and cut the motion short; a step now counts from the zoom in
  flight and retargets the running motion.
- ⌘0 after a window resize at a numeric zoom eased to the old Fit size and
  then jumped; the stale size is forgotten and Fit lays out directly.

Two more, older than the pass but made easier to hit by it: a document's
identity is now stamped before its save is written, so a new document
started while an autosave was in flight can no longer inherit the old
project's id and overwrite it; and Duplicate in the title menu saves the
open document first, so the copy carries the latest edit. Under Reduce
Motion, Esc on a closing sheet no longer falls through to the page.

### Tests

`npm test` passes 137 tests; the same 12 `scripts/` share-card tests fail as
on the original source. `npx tsc --noEmit` reports only the pre-existing
errors in `page-rail.tsx`, `error-component.tsx` and `lettering.test.ts`;
`npx eslint .` reports the same four pre-existing errors; `vite build`
passes.

## New features pass

Four features a pro page editor is expected to have, each built on its own,
run in the app and checked on screen (light and dark) before the next one.
Lettering, dragging, zoom, read mode, autosave and undo/redo were re-run
after every feature with the same Playwright scripts and did not change.

### Multi-selection

- **Select several balloons.** ⇧-click adds or removes a balloon, ⇧-drag on
  the paper draws a rubber band that picks every balloon it touches, and ⌘A
  selects every balloon on the page. The primary balloon keeps the strong
  outline, the others get a lighter one, and the inspector header reads
  "3 balloons".
- **Act on all of them at once.** Dragging any selected balloon moves the
  group; arrow keys nudge it; Delete, ⌘D and the format controls (size,
  weight, colour, balloon style, ink and so on) apply to every selected
  balloon. A group move or delete is one undo step.
- **Arrange ▸ Align and Distribute.** Align Left, Centres, Right, Top,
  Middles and Bottom line the selection up on its own bounds (one balloon
  aligns to the page). Distribute Horizontally and Vertically spread three
  or more balloons with equal gaps, keeping the outer two in place. The same
  commands sit in a small strip at the top of the inspector and in the
  command palette.
- A plain click on one balloon collapses the selection back to it.

### Named Undo and Redo

Every history step now carries its name, as in a Mac app: the Edit menu
reads "Undo Move", "Redo Typing", "Undo Add Speech", "Undo Apply Layout",
and the toolbar tooltips and the command palette say the same. Around
seventy actions are named; balloon edits are told apart as Typing, Move,
Resize, Format, Hide, Show, Lock and Unlock.

### Print guides and grid

- **View ▸ Print Guides (⌥⌘G)** draws printer's marks on the page being
  edited: the trim line, the safe area the layout keeps panels inside, the
  bleed to scale (the same padding Export adds), and crop marks outside the
  corners, with a small legend above the page.
- **View ▸ Grid (⌥⌘L)** rules the page every 10 mm with a heavier line every
  50 mm (every 50 px on the webtoon canvas).
- **Bleed slider.** The Document tab gains a Bleed slider in the page's own
  units (0 to 5 mm, or 0 to 40 px for webtoon). Bleed was already used by
  Export but had no control.
- Both are view settings: they persist on the device, are not part of the
  document, never mark it edited, never appear in read mode or in exports,
  and never catch the pointer.

### Version history

- **A version is kept automatically** each time you save, and every few
  minutes while autosave runs (versions closer than five minutes fold
  together; a save with no change adds nothing). The newest 50 automatic
  versions are kept per project.
- **File ▸ Save a Version (⌥⌘S)** keeps this moment on demand.
- **File ▸ Browse All Versions…** opens a sheet with the history on the left
  and a preview of the chosen version on the right. ↑↓ move through it,
  Return restores, the pencil names a version ("Inked", "Sent to editor"),
  and Delete removes one after a confirmation.
- **Restore** puts the document back to that version. What it replaces is
  kept first as a "Before restore" version, so a restore can always be
  taken back. **Restore a Copy** opens the version as a new project and
  leaves the original as it is.
- Versions live on the device in their own IndexedDB database, so a tab
  still running an older build keeps saving. Pictures are stored once and
  shared by every version that uses them, so fifty versions of a page with
  scanned art cost about one copy of the art. When the disk is nearly full,
  the oldest automatic versions make room first; named versions are never
  dropped to make room, and a save that cannot be written says so in one
  notice instead of failing silently. Deleting a project deletes its
  versions and any picture no other version uses.

### Keyboard additions

| Keys | Action |
| --- | --- |
| ⇧-click | Add or remove a balloon from the selection |
| ⌘-click | Same, without moving it (⌘-drag stays the precision move) |
| ⇧-drag on the paper | Rubber-band select |
| ⌘A | Select every balloon on the page |
| ⌥⌘G | Show or hide print guides |
| ⌥⌘L | Show or hide the grid |
| ⌥⌘S | Save a version |

On Windows and Linux, ⌘ is Ctrl and ⌥ is Alt.

### Review fixes

An adversarial review of the four features (each finding checked
independently against the running app) confirmed 30 problems. All are fixed
and were re-checked on screen:

- **Selection.** After a single balloon was picked again, an old
  multi-selection could come back, so Delete removed balloons that were no
  longer selected. A hidden balloon stayed selected out of sight. A plain
  click on a locked balloon did not collapse the selection. ⌘-click toggled
  on press, which broke ⌘-drag; it now toggles on release and a ⌘-drag
  still moves.
- **Group edits.** Cut, Copy, Paste and the inspector's Remove acted only on
  the primary balloon; they now carry the whole selection (one paste puts
  every copy back, still chained where the originals were). A+, A− and the
  wheel changed only the primary; they now step every selected balloon
  from its own size. A format change did nothing when the primary already had the
  value. Duplicating two chained balloons joined the copies to the
  original chain; the copies now get a chain of their own.
- **Arranging.** Aligning a selection with a locked balloon threw the others
  to the page edge (the locked one now anchors the alignment). Dragging or
  nudging a group into the page edge squashed it; the group now stops as one.
- **Undo names.** Steps that ran together took the wrong name, the wheel
  called rotation and scaling "Resize Type", and rotating, moving a tail,
  chaining by dropping a tail and unlocking a panel had no name of their
  own.
- **Guides and bleed.** Changing the bleed did not mark the document Edited.
  The grid drew over balloons. At high zoom the crop marks and legend were
  clipped. On reload the bleed band flashed and React reported a hydration
  mismatch. On webtoon pages the guides showed a bleed that the
  strip and canvas exports never add, so the Bleed slider is hidden there
  and webtoon bleed is zero. A bleed set in millimetres drifted when the
  paper size changed (3 mm on A4 became 2.1 mm on A5); it now stays 3 mm.
- **Versions.** On a full disk a save never finished and the error reached
  the console instead of the screen. Trimming old versions could drop named
  ones. Raising the database version would have broken saving in a second
  tab still running the older build. In the Versions sheet, a background
  refresh could override the row just clicked, the list went stale after
  the sheet's own Save, focus fell out of the list after a delete or Esc,
  ⌥⌘S on a never-saved document quietly created an "Untitled" project
  (it now opens the Save sheet), and Return could start a second restore
  while the first was running.

One older bug turned up while checking these: after a reload with B5,
Letter or another non-A4 paper size, the page was drawn A4-shaped until the
next edit, and a two-page spread logged a hydration error. Device
preferences used to shape the very first render, which differs from the
server's; they now apply right after it, so the page has the right shape
from the first frame, and they still apply when the browser refuses to
open its storage.

### Tests

The lettering script was re-run after every feature and after the fixes:
type stays 20.42 px from the first keystroke to after blur, words wrap
whole and nothing sits outside the balloon. The earlier Playwright
regression scripts (dragging, zoom, read mode, pinch, export, autosave and
reload, undo, sheets, menus, palette) give the same results as before.
`npm test`, `tsc`, `eslint` and `vite build` report the same as at the end
of the macOS pass.
