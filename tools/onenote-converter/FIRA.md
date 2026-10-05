# OneNote converter — Fira build

Source: `@joplin/onenote-converter` 3.7.1 (npm), from
<https://github.com/laurent22/joplin/tree/dev/packages/onenote-converter>.
License: MPL-2.0 (see `LICENSE`) — the package, not Joplin's AGPL. MPL is
file-level: the files we changed stay under MPL and their source stays here.

The built output lives in `src/lib/onenote/pkg/` and is committed, so a Fira
build does **not** need Rust. Rebuild only when this directory changes.

## Fira changes

1. **Browser filesystem.** Upstream reads/writes through Node's `fs`/`path` and
   `parser-utils/node_functions.js`. `parser-utils/src/file_api/wasm_driver.rs`
   now imports all of them from `parser-utils/fira_fs.js`, an in-memory
   filesystem the page fills (`globalThis.__firaOneNoteFs`, see
   `src/lib/onenote/convert.ts`). Built with `--target web`.
2. **Missing timestamps do not drop pages.** Upstream fails the whole page when
   an outline, rich-text, table, title, list or embedded-file node has no
   `LastModifiedTime` (templates and clipboard captures). Those checks use
   `unwrap_or_default()` now; `Time` derives `Default`. Without this 2 of 813
   pages of the FLPDev notebook were lost.

3. **Pages are read as they are now.** Upstream took a page's content and
   metadata roots from the *first* revision in its revision list (see the TODO it
   left in `local_onestore/objects/object_space.rs`) — i.e. the page as first
   saved: later text and images, ticked to-dos and later titles were missing, and
   sections re-saved by a recent OneNote failed on version-history spaces
   (0x20046). Now, per MS-ONESTORE 2.1.8, `RevisionManifestList.current` tracks
   the current revision for each (context, role) — the last revision manifest or
   `RevisionRole(AndContext)DeclarationFND` wins — and `ObjectSpace` resolves the
   roots and every object along the current default-context revision's
   dependency chain (`current_chain`), falling back to the old behaviour when a
   space has no such revision. On the FLPDev notebook: images 684 → 2 492, text
   0.55 M → 1.63 M characters, BA.one 18 → 71 readable pages.

4. **Page history.** Fira imports a page's earlier states as page versions.
   `ObjectSpace::history_revisions()` lists every revision except the current
   one (newest first) — the earlier states are dependent revisions *without*
   roots that carry the objects as they used to be, plus other-context
   revisions — and `at_revision(rid)` gives a view resolved along that
   revision's chain, keeping the current metadata root (older revisions often
   carry version-history metadata that does not parse as a page).
   `page_series.rs` parses each view into `Page::history` (skipping ones that do
   not parse); `section.rs` writes them as `__fira_rev__<toc order>__<k>.html`
   (k = 0 newest) next to the section's pages, and `convert.ts` groups them.
   Rendering carries `X-Author` (last editor as OneNote records it).
   - `Page::history()` parses the revisions lazily, one at a time, while the
     renderer writes them. Holding them all at once grew wasm memory past a
     gigabyte and every `memory.grow` copied the heap (BA.one, 590 revisions:
     94 s → 16 s; the whole FLPDev notebook, 1 950 revisions: 21 s).
   - Each view flattens its chain into one map (`ObjectSpace::resolved`)
     instead of walking the chain on every object lookup.
   - The file does not keep revisions in time order; the importer sorts them
     (`parse.ts` `readHistory`) before dropping states identical to the next
     newer one.
   - Old revisions show the same images and attachments again: `page/image.rs`
     and `page/embedded_file.rs` write identical bytes once per section
     (`image_by_content`, `file_by_content`) instead of a new copy per revision
     (FLPDev: 1 550 MB of output → 524 MB).

## Rebuild

Needs Rust with the `wasm32-unknown-unknown` target and `wasm-pack` 0.13:

```sh
rustup target add wasm32-unknown-unknown
npm i -g wasm-pack@0.13.1        # or use a local copy
cd tools/onenote-converter
wasm-pack build --target web --release --no-pack --out-dir ../../../src/lib/onenote/pkg ./renderer
rm ../../src/lib/onenote/pkg/.gitignore   # wasm-pack writes "*" there; the build is committed
```

On Windows the `x86_64-pc-windows-gnu` host toolchain works without Visual
Studio (`rustup-init --default-host x86_64-pc-windows-gnu --profile minimal`).

## Runtime notes

- The page must allow WebAssembly: CSP `script-src 'self' 'wasm-unsafe-eval'`
  (`deploy/nginx/snippets/fira-security-headers.conf`).
- nginx serves `.wasm` as `application/octet-stream`; the wasm-bindgen loader
  falls back from streaming compilation and still works (console warning).
- The notebook's `.onetoc2` does not parse with this version; the importer
  converts each `.one` section on its own and takes the hierarchy from folders.
