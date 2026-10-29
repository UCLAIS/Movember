import {createHash} from 'node:crypto';
import {mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {page, signupPage, PUBLIC_SITE_ORIGIN, BACKEND_ORIGIN} from '../worker/index.js';
import {loadParticipatingTeams} from '../client/participating-teams.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, '_site');

export function pagesDocument(template, {signup = false} = {}) {
  let html = template;
  if (signup) {
    html = html.replace('<!-- participating-teams -->', '<div id="participating-teams" class="team-links-empty" aria-live="polite" aria-busy="true">Loading society links…</div><noscript><p>Turn on JavaScript to load society links, or <a href="' + BACKEND_ORIGIN + '/sign-up">view the team links here</a>.</p></noscript>');
    html = html.replace('</script>', '\n(' + loadParticipatingTeams.toString() + ')(' + JSON.stringify(BACKEND_ORIGIN) + ');\n</script>');
  } else {
    // Keep the normal Worker page same-origin. Only this static export crosses origins.
    html = html.replaceAll("fetch('/api/", 'fetch(' + JSON.stringify(BACKEND_ORIGIN) + "+'/api/");
    html = html.replaceAll("{cache:'no-store'}", "{cache:'no-store',credentials:'omit'}");
    html = html.replace("document.getElementById('admin-link').hidden=!list.canEdit;", '');
    html = html.replace('class="admin-link" hidden', 'class="admin-link"');
    html = html.replace('href="/admin/login"', 'href="' + BACKEND_ORIGIN + '/admin/login"');
  }
  const hashes = tag => [...html.matchAll(new RegExp('<' + tag + '>([\\s\\S]*?)</' + tag + '>', 'g'))]
    .map(match => "'sha256-" + createHash('sha256').update(match[1]).digest('base64') + "'").join(' ') || "'none'";
  // Pages cannot set HTTP CSP headers. A meta policy protects scripts, styles and API reads.
  const policy = "default-src 'none'; script-src " + hashes('script') + '; style-src ' + hashes('style') + '; connect-src ' + BACKEND_ORIGIN + "; img-src 'self' data:; font-src data:; base-uri 'none'; form-action 'none'; object-src 'none'";
  const canonical = PUBLIC_SITE_ORIGIN + (signup ? '/sign-up/' : '/');
  return html.replace('<head>', '<head><meta http-equiv="Content-Security-Policy" content="' + policy + '"><meta name="referrer" content="no-referrer"><link rel="canonical" href="' + canonical + '">');
}

export async function buildPages() {
  const domain = (await readFile(resolve(root, 'CNAME'), 'utf8')).trim();
  if (domain !== new URL(PUBLIC_SITE_ORIGIN).hostname) throw new Error('CNAME must match the public origin before building.');
  await rm(output, {recursive: true, force: true});
  await mkdir(resolve(output, 'sign-up'), {recursive: true});
  await mkdir(resolve(output, 'admin/login'), {recursive: true});
  await writeFile(resolve(output, 'index.html'), pagesDocument(page));
  await writeFile(resolve(output, 'sign-up/index.html'), pagesDocument(signupPage, {signup: true}));
  await writeFile(resolve(output, 'CNAME'), domain + '\n');
  await writeFile(resolve(output, '.nojekyll'), '');
  const ownerUrl = BACKEND_ORIGIN + '/admin/login';
  await writeFile(resolve(output, 'admin/login/index.html'), '<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="robots" content="noindex"><meta http-equiv="refresh" content="0;url=' + ownerUrl + '"><title>Manage teams</title></head><body><p><a href="' + ownerUrl + '">Sign in to manage teams</a></p></body></html>');
  console.log('Built public Pages site at ' + output);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildPages();
