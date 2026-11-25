import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanArticleHtml, wordCountOf } from "../src/sanitize.js";

test("keeps the reader whitelist and drops everything else", () => {
  const html = `
    <div class="x"><p style="color:red">Hello <b>bold</b> <i>it</i> <span>plain</span></p>
    <img src="a.jpg"><figure><img src="b.jpg"><figcaption>Caption text</figcaption></figure>
    <script>alert(1)</script><iframe src="https://evil"></iframe>
    <h1>Big</h1><table><tr><td>cell</td></tr></table></div>`;
  const out = cleanArticleHtml(html);
  assert.match(out, /<p>Hello <strong>bold<\/strong> <em>it<\/em> plain<\/p>/);
  assert.match(out, /<h2>Big<\/h2>/);
  for (const banned of ["img", "figure", "Caption", "script", "alert", "iframe", "style=", "cell", "class="]) {
    assert.ok(!out.includes(banned), `should not contain ${banned}: ${out}`);
  }
});

test("only http(s) links survive, and they open in a new tab", () => {
  const out = cleanArticleHtml(
    '<p><a href="javascript:alert(1)">bad</a> <a href="https://ok.example/x" onclick="x()">good</a> <a href="/relative">rel</a></p>',
  );
  assert.ok(!out.includes("javascript:"));
  assert.ok(!out.includes("onclick"));
  assert.ok(!out.includes("/relative"));
  assert.match(out, /<a href="https:\/\/ok\.example\/x" target="_blank" rel="noopener noreferrer">good<\/a>/);
});

test("drops newsletter plugs, empty blocks and a repeated headline", () => {
  const out = cleanArticleHtml(
    "<h2>My Story</h2><p>Real text.</p><p>Sign up for our newsletter!</p><p>  </p><ul><li></li></ul><p>Read more: elsewhere</p>",
    { title: "My story" },
  );
  assert.equal(out, "<p>Real text.</p>");
});

test("word count ignores markup", () => {
  assert.equal(wordCountOf("<p>One <em>two</em></p><p>three-four five's</p>"), 4);
});
