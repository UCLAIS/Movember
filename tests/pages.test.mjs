import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import worker, {page, signupPage, PUBLIC_SITE_ORIGIN, BACKEND_ORIGIN} from '../worker/index.js';
import {pagesDocument} from '../scripts/build-pages.mjs';
import {loadParticipatingTeams} from '../client/participating-teams.js';
import {localD1} from '../scripts/local-d1.mjs';

test('Pages can read public API results, with no credentialed or write access', async context => {
  const url = BACKEND_ORIGIN + '/api/teams';
  const DB = localD1();
  context.after(() => DB.close());
  const env = {DB, LEADERBOARD_OWNER_EMAIL: 'owner@example.test'};
  const owner = {'oai-authenticated-user-id': 'test-owner', 'oai-authenticated-user-email': 'owner@example.test'};
  const allowed = await worker.fetch(new Request(url, {headers: {Origin: PUBLIC_SITE_ORIGIN, ...owner}}), env);
  assert.equal(allowed.headers.get('Access-Control-Allow-Origin'), PUBLIC_SITE_ORIGIN);
  assert.equal(allowed.headers.get('Access-Control-Allow-Credentials'), null);
  assert.equal(allowed.headers.get('Vary'), 'Origin');
  assert.equal((await allowed.json()).canEdit, false);
  for (const origin of ['https://evil.test', PUBLIC_SITE_ORIGIN + '.evil.test', 'null']) {
    const response = await worker.fetch(new Request(url, {headers: {Origin: origin}}), env);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
  }
  const blocked = await worker.fetch(new Request(url, {method: 'PUT', headers: {Origin: PUBLIC_SITE_ORIGIN, ...owner, 'Content-Type': 'application/json'}, body: '{"teams":[],"revision":0}'}), env);
  assert.equal(blocked.status, 403);
  assert.equal(blocked.headers.get('Access-Control-Allow-Origin'), null);
  const admin = await worker.fetch(new Request(BACKEND_ORIGIN + '/admin', {headers: {Origin: PUBLIC_SITE_ORIGIN}}), env);
  assert.equal(admin.status, 404);
  assert.equal(admin.headers.get('Access-Control-Allow-Origin'), null);
  const error = await worker.fetch(new Request(BACKEND_ORIGIN + '/api/totals?platform=movember&url=https://evil.test', {headers: {Origin: PUBLIC_SITE_ORIGIN}}), env);
  assert.equal(error.status, 400);
  assert.equal(error.headers.get('Access-Control-Allow-Origin'), PUBLIC_SITE_ORIGIN);
});

test('static pages reuse the design with exact script hashes and a read-only API origin', () => {
  for (const [template, signup] of [[page, false], [signupPage, true]]) {
    const html = pagesDocument(template, {signup});
    const policy = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
    assert.ok(policy.includes('connect-src ' + BACKEND_ORIGIN + ';'));
    assert.ok(!policy.includes('unsafe-inline'));
    for (const tag of ['script', 'style']) {
      for (const match of html.matchAll(new RegExp('<' + tag + '>([\\s\\S]*?)</' + tag + '>', 'g'))) {
        assert.ok(policy.includes("'sha256-" + createHash('sha256').update(match[1]).digest('base64') + "'"));
        if (tag === 'script') new Function(match[1]);
      }
    }
    assert.doesNotMatch(html, /fetch\('\/api\//);
    assert.doesNotMatch(html, /setInterval|visibilitychange/);
    assert.ok(html.includes("credentials:'omit'") || html.includes("credentials: 'omit'"));
    assert.doesNotMatch(html, /id="team-form"|LEADERBOARD_OWNER_EMAIL|oai-authenticated-user/);
  }
  const root = pagesDocument(page);
  assert.ok(root.includes('href="' + BACKEND_ORIGIN + '/admin/login"'));
  assert.ok(root.includes('class="admin-link">'));
  const signup = pagesDocument(signupPage, {signup: true});
  assert.ok(signup.includes('id="participating-teams"'));
  assert.ok(!signup.includes('<!-- participating-teams -->'));
});

test('static sign-up loads current team links once, safely, and reports failures', async () => {
  const originalDocument = globalThis.document, originalFetch = globalThis.fetch;
  class Element {
    children = [];
    attributes = {};
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    setAttribute(name, value) { this.attributes[name] = value; }
  }
  const container = new Element();
  let calls = 0;
  globalThis.document = {getElementById: () => container, createElement: () => new Element()};
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.equal(url, BACKEND_ORIGIN + '/api/teams');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.cache, 'no-store');
    return Response.json({teams: [
      {name: '<img onerror=alert(1)>', url: 'https://uk.movember.com/team/123'},
      {name: 'Society B', url: 'https://www.justgiving.com/team/society-b'},
      {name: 'Unsafe', url: 'javascript:alert(1)'},
      {name: 'Wrong host', url: 'https://www.justgiving.com.evil.test/team/123'},
    ]});
  };
  try {
    await loadParticipatingTeams(BACKEND_ORIGIN);
    assert.equal(calls, 1);
    assert.equal(container.children[0].children.length, 2);
    assert.equal(container.children[0].children[0].children[0].textContent, '<img onerror=alert(1)>');
    assert.equal(container.attributes['aria-busy'], 'false');
    globalThis.fetch = async () => {throw new Error('Offline');};
    await loadParticipatingTeams(BACKEND_ORIGIN);
    assert.match(container.textContent, /Could not load/);
    globalThis.fetch = async () => Response.json({teams: []});
    await loadParticipatingTeams(BACKEND_ORIGIN);
    assert.match(container.textContent, /as they join/);
  } finally {
    globalThis.document = originalDocument;
    globalThis.fetch = originalFetch;
  }
});
