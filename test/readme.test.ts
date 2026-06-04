// @ts-nocheck
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const readmePath = path.join(__dirname, "..", "README.md");
const readme = fs.readFileSync(readmePath, "utf8");

// License badge — changed from Apache-2.0 to AGPL-3.0 in this PR

test("license badge references AGPL-3.0", () => {
  assert.ok(
    readme.includes("license-AGPL--3.0-blue.svg"),
    "Badge image URL should use AGPL-3.0"
  );
});

test("license badge alt text is AGPL-3.0", () => {
  assert.ok(
    readme.includes('alt="License: AGPL-3.0"'),
    "Badge alt text should say AGPL-3.0"
  );
});

test("license badge does not reference Apache-2.0", () => {
  assert.ok(
    !readme.includes("license-Apache--2.0-blue.svg"),
    "Badge image URL must not contain Apache-2.0 after the PR change"
  );
});

// Comparison table — open-source entry updated from Apache-2.0 to AGPL-3.0

test("comparison table open-source row shows AGPL-3.0", () => {
  assert.ok(
    readme.includes("✅ AGPL-3.0"),
    "Comparison table should list AGPL-3.0 as the open-source licence"
  );
});

test("comparison table open-source row does not show Apache-2.0", () => {
  assert.ok(
    !readme.includes("✅ Apache-2.0"),
    "Comparison table must not reference Apache-2.0 after the PR change"
  );
});

// Contact email — added in this PR

test("contact email hi@autter.dev is present", () => {
  assert.ok(
    readme.includes("hi@autter.dev"),
    "README should contain the contact email hi@autter.dev"
  );
});

test("contact email appears in the Autter callout paragraph", () => {
  const calloutLine = readme
    .split("\n")
    .find((line) => line.includes("hi@autter.dev"));
  assert.ok(calloutLine !== undefined, "hi@autter.dev should appear in the README");
  assert.ok(
    calloutLine.includes("autter.dev"),
    "The contact email line should be in the Autter section"
  );
});

// License section — rewritten in this PR to dual-license (AGPL-3.0 + Commercial)

test("license section mentions dual-licensed", () => {
  assert.ok(
    readme.includes("dual-licensed"),
    "License section should state the project is dual-licensed"
  );
});

test("license section links to AGPL-3.0", () => {
  assert.ok(
    readme.includes("[AGPL-3.0](./LICENSE)"),
    "License section should link AGPL-3.0 to ./LICENSE"
  );
});

test("license section mentions commercial license option", () => {
  assert.ok(
    readme.toLowerCase().includes("commercial"),
    "License section should mention a commercial licensing option"
  );
});

test("license section references LICENSE.md", () => {
  assert.ok(
    readme.includes("LICENSE.md"),
    "License section should reference LICENSE.md for full details"
  );
});

test("license section does not describe Apache-2.0 terms", () => {
  // The old text said "Released under the Apache-2.0 license. You are free to use, modify..."
  assert.ok(
    !readme.includes("Released under the [Apache-2.0]"),
    "Old Apache-2.0 release statement must not appear after the PR change"
  );
});

// Removed image — the banner image after the title was deleted in this PR

test("removed banner image tag is no longer present", () => {
  // The removed image had specific dimensions 1067x942 and pointed to github user-attachments
  assert.ok(
    !readme.includes('width="1067" height="942"'),
    "Banner image with dimensions 1067x942 should have been removed"
  );
});

// Regression: overall README structure remains intact

test("README still contains the main heading", () => {
  assert.ok(readme.startsWith("# Email Validator"), "README must start with the main heading");
});

test("README still contains the license section heading", () => {
  assert.ok(
    readme.includes("## License"),
    "README must retain the License section heading"
  );
});
