#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const {
  validateReadmeVisualsContent,
} = require("./validate-readme-visuals.js");

const readmePath = path.resolve(__dirname, "../../README.md");
const readme = fs.readFileSync(readmePath, "utf8");

function errorsFor(markdown) {
  return validateReadmeVisualsContent(markdown).errors;
}

test("accepts the project hero logo and shields.io badges", () => {
  const markdown = `
<div align="center">
  <img src="assets/chatgpt.png" alt="ChatGPT for Linux project logo" width="128" height="128">
  <p>
    <a href="#quick-start"><img alt="Packages" src="https://img.shields.io/badge/packages-deb-2f81f7?style=flat-square"></a>
    <a href="#releases"><img alt="Release" src="https://img.shields.io/github/v/release/nisavid/chatgpt-linux"></a>
  </p>
</div>
`;

  assert.deepEqual(errorsFor(markdown), []);
});

test("keeps the real README project hero and shield set", () => {
  assert.deepEqual(validateReadmeVisualsContent(readme).errors, []);
  assert.match(
    readme,
    /<img src="assets\/chatgpt\.png" alt="ChatGPT for Linux project logo" width="128" height="128">/,
  );
  assert.match(readme, /ChatGPT for Linux is an unofficial community project/);
  assert.match(readme, /OpenAI has released its official ChatGPT app for Linux in preview/);
  assert.match(readme, /If the official release is acceptable, ChatGPT for Linux\s*> will be sunset/);
  assert.match(readme, /this project remains a maintained\s*> fallback/);
  assert.match(readme, /`chatgpt-desktop-bin` native repackage/);
  assert.match(readme, /both use the `chatgpt` package and command name, so they are mutually\s*exclusive/);
  assert.match(readme, /For that CachyOS\/pacman path/);
  assert.match(
    readme,
    /\[official-app evaluation switch procedure\]\(docs\/maintainers\/package-runtime-maintenance\.md#official-app-evaluation-switch\)/,
  );
  assert.match(readme, /OpenAI's official Linux package is\s*not this fork's\s*current build source/);
  assert.match(
    readme,
    /git clone https:\/\/github\.com\/nisavid\/chatgpt-linux\.git chatgpt-linux\ncd chatgpt-linux/,
  );
  assert.doesNotMatch(readme, /nisavid\/codex-app-linux/);
  assert.match(
    readme,
    /not affiliated\s*> with, endorsed by, sponsored by, or supported by OpenAI/,
  );
  assert.match(readme, /Larry Ewing and\s*> The GIMP, Garrett LeSage, and IFo Hancroft/);
  assert.match(
    readme,
    /\[project-logo rights record\]\(docs\/maintainers\/project-logo-rights-research\.md\)/,
  );
  const shields = [...readme.matchAll(/<img alt="([^"]+)" src="(https:\/\/img\.shields\.io\/[^"]+)">/g)]
    .map((match) => [match[1], match[2]]);
  assert.deepEqual(shields, [
    ["Packages: deb, rpm, pacman", "https://img.shields.io/badge/packages-deb%20%7C%20rpm%20%7C%20pacman-2f81f7?style=flat-square"],
    ["Updater: chatgpt-updater", "https://img.shields.io/badge/updater-chatgpt--updater-1f883d?style=flat-square"],
    ["Focus: hardening and polish", "https://img.shields.io/badge/focus-hardening%20%2B%20polish-8250df?style=flat-square"],
  ]);
});

test("keeps the approved project SVG and raster logo assets distinct", () => {
  const assetsDir = path.resolve(__dirname, "../../assets");
  const approvedSvg = fs.readFileSync(
    path.join(assetsDir, "chatgpt-linux-project-logo.svg"),
  );
  assert.equal(
    crypto.createHash("sha256").update(approvedSvg).digest("hex"),
    "0af87e4126277df510b84d9df858e68446ee119384ed740d1617363a66f585ae",
    "approved project SVG",
  );

  const expected = new Map([
    ["chatgpt.png", { digest: "7c99c9d3f6a4360a50704f18b1839feb96f053b1a4bca7292b6fdcfa992a65e8", size: 512 }],
    ["chatgpt-linux.png", { digest: "09f991eabe8c688431dae22de21a8b2c9fe66df49439b5734286f2613f69c19b", size: 256 }],
  ]);

  for (const [name, { digest, size }] of expected) {
    const logo = fs.readFileSync(path.join(assetsDir, name));
    assert.equal(logo.subarray(1, 4).toString("ascii"), "PNG", name);
    assert.equal(logo.readUInt32BE(16), size, `${name} width`);
    assert.equal(logo.readUInt32BE(20), size, `${name} height`);
    assert.equal(crypto.createHash("sha256").update(logo).digest("hex"), digest, name);
  }

  for (const retiredOpenAiAsset of ["codex.png", "codex-linux.png"]) {
    assert.equal(
      fs.existsSync(path.join(assetsDir, retiredOpenAiAsset)),
      false,
      `${retiredOpenAiAsset} is not committed as project branding`,
    );
  }
});

test("accepts local showcase images under docs/assets/readme with alt text", () => {
  const markdown = `
![Codex workbench on a Linux desktop](docs/assets/readme/workbench.png)
![Codex workbench with angle destination](<docs/assets/readme/workbench-angle.png>)

<img src="docs/assets/readme/browser-use-annotations.webp" alt="Browser Use annotations in Codex">
`;

  assert.deepEqual(errorsFor(markdown), []);
});

test("accepts local reference-style showcase images with alt text", () => {
  const markdown = `
![Codex workbench on Linux][workbench]
![Browser Use annotations][]
![Diff view with change summary]

[workbench]: docs/assets/readme/workbench.png
[Browser Use annotations]: docs/assets/readme/browser-use-annotations.webp
[Diff view with change summary]: docs/assets/readme/diff-view.png
`;

  assert.deepEqual(errorsFor(markdown), []);
});

test("rejects local showcase images outside docs/assets/readme", () => {
  const markdown = `
![Codex workbench](assets/workbench.png)
`;

  assert.deepEqual(errorsFor(markdown), [
    "README showcase image must live under docs/assets/readme/: assets/workbench.png",
  ]);
});

test("rejects reference-style showcase image sources outside policy", () => {
  const markdown = `
![Remote showcase][remote]
![Out-of-scope showcase][outside]
![Multiline remote showcase][multiline-remote]
![Whitespace remote showcase] [whitespace-remote]
> ![Blockquote remote showcase][blockquote-remote]
![Duplicate remote showcase][duplicate]
![Escaped bracket remote showcase][escaped\\]]
![Balanced bracket remote showcase][balanced[bracket]]

[remote]: https://example.com/workbench.png
[outside]: assets/workbench.png
[multiline-remote]:
  https://example.com/multiline-workbench.png
[whitespace-remote]: https://example.com/whitespace-workbench.png
> [blockquote-remote]: https://example.com/blockquote-workbench.png
[duplicate]: https://example.com/duplicate-workbench.png
[duplicate]: docs/assets/readme/duplicate-workbench.png
[escaped\\]]: https://example.com/escaped-bracket-workbench.png
[balanced[bracket]]: https://example.com/balanced-bracket-workbench.png
`;

  assert.deepEqual(errorsFor(markdown), [
    "README showcase image must be a local repo asset, not an external URL: https://example.com/workbench.png",
    "README showcase image must live under docs/assets/readme/: assets/workbench.png",
    "README showcase image must be a local repo asset, not an external URL: https://example.com/multiline-workbench.png",
    "README showcase image must be a local repo asset, not an external URL: https://example.com/whitespace-workbench.png",
    "README showcase image must be a local repo asset, not an external URL: https://example.com/blockquote-workbench.png",
    "README showcase image must be a local repo asset, not an external URL: https://example.com/duplicate-workbench.png",
    "README showcase image must be a local repo asset, not an external URL: https://example.com/escaped-bracket-workbench.png",
    "README showcase image must be a local repo asset, not an external URL: https://example.com/balanced-bracket-workbench.png",
  ]);
});

test("rejects showcase paths that escape docs/assets/readme", () => {
  const markdown = `
![Escaped showcase](docs/assets/readme/../outside.png)
![Encoded escaped showcase](docs/assets/readme/%2e%2e/outside.png)
`;

  assert.deepEqual(errorsFor(markdown), [
    "README showcase image must live under docs/assets/readme/: docs/assets/readme/../outside.png",
    "README showcase image must live under docs/assets/readme/: docs/assets/readme/%2e%2e/outside.png",
  ]);
});

test("rejects showcase images without useful alt text", () => {
  const markdown = `
![](docs/assets/readme/workbench.png)
<img src="docs/assets/readme/browser-use.png">
`;

  assert.deepEqual(errorsFor(markdown), [
    "README showcase image is missing alt text: docs/assets/readme/workbench.png",
    "README showcase image is missing alt text: docs/assets/readme/browser-use.png",
  ]);
});

test("rejects external showcase image URLs", () => {
  const markdown = `
![Remote showcase](https://example.com/workbench.png)
![Remote showcase with title](https://example.com/workbench-title.png 'title')
![Remote showcase with angle destination](<https://example.com/workbench-angle.png>)
![Remote showcase with spaced angle destination](<https://example.com/workbench screenshot.png>)
![Remote showcase [with state]](https://example.com/workbench-state.png)
![Remote showcase with balanced parentheses](https://example.com/workbench(annotated).png)
![Remote showcase with padded destination]( https://example.com/workbench-padded.png )
![Remote showcase with newline-padded destination](
https://example.com/workbench-newline-padded.png)
![Remote showcase with protocol-relative URL](//docs/assets/readme/workbench.png)
`;

  assert.deepEqual(errorsFor(markdown), [
    "README showcase image must be a local repo asset, not an external URL: https://example.com/workbench.png",
    "README showcase image must be a local repo asset, not an external URL: https://example.com/workbench-title.png",
    "README showcase image must be a local repo asset, not an external URL: https://example.com/workbench-angle.png",
    "README showcase image must be a local repo asset, not an external URL: https://example.com/workbench screenshot.png",
    "README showcase image must be a local repo asset, not an external URL: https://example.com/workbench-state.png",
    "README showcase image must be a local repo asset, not an external URL: https://example.com/workbench(annotated).png",
    "README showcase image must be a local repo asset, not an external URL: https://example.com/workbench-padded.png",
    "README showcase image must be a local repo asset, not an external URL: https://example.com/workbench-newline-padded.png",
    "README showcase image must be a local repo asset, not an external URL: //docs/assets/readme/workbench.png",
  ]);
});

test("reports external URLs before checking alt text", () => {
  const markdown = `
![](https://example.com/workbench.png)
`;

  assert.deepEqual(errorsFor(markdown), [
    "README showcase image must be a local repo asset, not an external URL: https://example.com/workbench.png",
  ]);
});

test("rejects generated or runtime artifact paths even when local", () => {
  const markdown = `
![Generated app screenshot](chatgpt/screenshot.png)
![Package output screenshot](dist/workbench.png)
`;

  assert.deepEqual(errorsFor(markdown), [
    "README showcase image must live under docs/assets/readme/: chatgpt/screenshot.png",
    "README showcase image must not reference generated or runtime artifacts: chatgpt/screenshot.png",
    "README showcase image must live under docs/assets/readme/: dist/workbench.png",
    "README showcase image must not reference generated or runtime artifacts: dist/workbench.png",
  ]);
});

test("ignores image-like syntax inside fenced code blocks", () => {
  const markdown = `
\`\`\`markdown
![External example](https://example.com/workbench.png)
<img src="assets/out-of-scope.png">
\`\`\`

> \`\`\`markdown
> ![External blockquote example](https://example.com/blockquote-workbench.png)
> \`\`\`
`;

  assert.deepEqual(errorsFor(markdown), []);
});

test("ignores image-like syntax inside inline code spans", () => {
  const markdown = `
Use \`![External example](https://example.com/workbench.png)\` when documenting Markdown syntax.
Use \`<img src="assets/out-of-scope.png">\` when documenting HTML syntax.
`;

  assert.deepEqual(errorsFor(markdown), []);
});

test("preserves inline code spans inside image alt text", () => {
  const markdown = `
![\`Codex\`](docs/assets/readme/workbench.png)
<img src="docs/assets/readme/browser-use.png" alt="\`Browser Use\`">
`;

  assert.deepEqual(errorsFor(markdown), []);
});

test("validates images between escaped backticks", () => {
  const markdown = `
\\\` literal ![Escaped backtick remote](https://example.com/escaped-backtick.png) \\\`
`;

  assert.deepEqual(errorsFor(markdown), [
    "README showcase image must be a local repo asset, not an external URL: https://example.com/escaped-backtick.png",
  ]);
});

test("ignores escaped Markdown image syntax", () => {
  const markdown = `
\\![External example](https://example.com/workbench.png)
`;

  assert.deepEqual(errorsFor(markdown), []);
});

test("validates HTML source srcset image references", () => {
  const markdown = `
<picture>
  <source srcset="https://example.com/workbench.avif 1x, docs/assets/readme/workbench.webp 2x" type="image/avif">
  <img src="docs/assets/readme/workbench.png" alt="Codex workbench">
</picture>
`;

  assert.deepEqual(errorsFor(markdown), [
    "README showcase image must be a local repo asset, not an external URL: https://example.com/workbench.avif",
  ]);
});

test("does not strip images between backticks on different lines", () => {
  const markdown = `
Opening \` marker on one line.
![Remote showcase](https://example.com/workbench.png)
Closing \` marker on another line.
`;

  assert.deepEqual(errorsFor(markdown), [
    "README showcase image must be a local repo asset, not an external URL: https://example.com/workbench.png",
  ]);
});

test("reports unreadable README paths without a stack trace", () => {
  const scriptPath = path.join(__dirname, "validate-readme-visuals.js");
  const result = spawnSync(process.execPath, [scriptPath, "missing-readme.md"], {
    cwd: __dirname,
    encoding: "utf8",
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /validate-readme-visuals\.js: missing-readme\.md: /);
  assert.doesNotMatch(result.stderr, /\n\s+at /);
});
