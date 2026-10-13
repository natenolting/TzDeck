import assert from "node:assert/strict";
import test from "node:test";

import { EXTENSION_DENY_URLS, EXTENSION_IGNORE_ERRORS } from "./sentryFilters";

const denied = (url: string) => EXTENSION_DENY_URLS.some((pattern) => pattern.test(url));

test("extension scripts are filtered, whichever browser injected them", () => {
  for (const url of [
    "chrome-extension://nkbihfbeogaeaoehlefnkodbefgpgknn/scripts/inpage.js",
    "moz-extension://4b1c8f2e-0000-4000-8000-000000000000/content.js",
    "safari-web-extension://ABCDEF/inject.js",
    "app:///scripts/inpage.js",
  ]) {
    assert.ok(denied(url), url);
  }
});

test("TzDeck's own scripts are never filtered", () => {
  for (const url of [
    "https://tzdeck.xyz/_next/static/chunks/app/page-abc123.js",
    "app:///_next/static/chunks/main-app.js",
    "http://localhost:3000/_next/static/chunks/webpack.js",
  ]) {
    assert.equal(denied(url), false, url);
  }
});

test("the MetaMask messages Sentry reported are ignored", () => {
  for (const message of ["Failed to connect to MetaMask", "MetaMask extension not found"]) {
    assert.ok(EXTENSION_IGNORE_ERRORS.some((ignored) => message.includes(ignored)), message);
  }
});
