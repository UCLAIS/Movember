// Run once on the static sign-up page. Team names are always plain text.
export async function loadParticipatingTeams(apiOrigin) {
  const container = document.getElementById('participating-teams');
  try {
    const response = await fetch(apiOrigin + '/api/teams', {cache: 'no-store', credentials: 'omit'});
    if (!response.ok) throw new Error('Could not load teams.');
    const {teams} = await response.json();
    const list = document.createElement('ul');
    list.className = 'team-links';
    for (const team of teams) {
      const url = new URL(team.url);
      const movember = url.hostname === 'uk.movember.com' && /^\/team\/\d+\/?$/.test(url.pathname);
      const justgiving = ['www.justgiving.com', 'justgiving.com'].includes(url.hostname) && /^\/(team|page|campaign|fundraising)\/[a-zA-Z0-9_-]+\/?$/.test(url.pathname);
      if (url.protocol !== 'https:' || url.username || url.password || url.port || (!movember && !justgiving)) continue;
      const platform = movember ? 'Movember' : 'JustGiving';
      const item = document.createElement('li'), link = document.createElement('a'), source = document.createElement('span');
      link.href = url.href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = team.name || platform + ' · ' + decodeURIComponent(url.pathname.split('/').filter(Boolean).pop());
      source.textContent = platform;
      item.append(link, source);
      list.append(item);
    }
    if (list.children.length) container.replaceChildren(list);
    else container.textContent = 'Societies’ team links will appear here as they join.';
  } catch {
    container.textContent = 'Could not load the team links. Reload the page to try again.';
  } finally {
    container.setAttribute('aria-busy', 'false');
  }
}
