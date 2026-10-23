// Auto-updates the profile README with the owner's GitHub pull requests.
// Runs inside GitHub Actions with GITHUB_TOKEN; see .github/workflows/update-prs.yml
import { readFile, writeFile } from 'node:fs/promises';

const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const username =
  process.env.PROFILE_USERNAME ||
  process.env.GITHUB_REPOSITORY_OWNER ||
  process.env.GITHUB_REPOSITORY?.split('/')[0];
const readmePath = process.env.README_PATH || 'README.md';

if (!token) throw new Error('Missing GH_TOKEN / GITHUB_TOKEN');
if (!username) throw new Error('Missing GitHub username');

async function search(query, perPage = 100) {
  const url = new URL('https://api.github.com/search/issues');
  url.searchParams.set('q', query);
  url.searchParams.set('sort', 'updated');
  url.searchParams.set('order', 'desc');
  url.searchParams.set('per_page', String(perPage));

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'profile-readme-updater',
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub search failed (${res.status}): ${await res.text()}`);
  }
  return res.json();
}

function repoNameFromApiUrl(apiUrl) {
  const match = /repos\/([^/]+)\/([^/]+)$/.exec(apiUrl || '');
  return match ? `${match[1]}/${match[2]}` : 'unknown/repo';
}

function oneLine(text) {
  return String(text == null ? '' : text)
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ')
    .trim();
}

function renderList(items) {
  if (!items || items.length === 0) {
    return '_Nothing here yet._';
  }
  return items
    .map((item) => {
      const repo = repoNameFromApiUrl(item.repository_url);
      const title = oneLine(item.title);
      return `- [\`${repo}#${item.number}\`](${item.html_url}) — ${title}`;
    })
    .join('\n');
}

function replaceSection(content, name, body) {
  const start = `<!--START_SECTION:${name}-->`;
  const end = `<!--END_SECTION:${name}-->`;
  const pattern = new RegExp(`${start}[\\s\\S]*?${end}`);
  if (!pattern.test(content)) {
    throw new Error(
      `README is missing the "${name}" markers (${start} ... ${end})`,
    );
  }
  return content.replace(pattern, `${start}\n${body}\n${end}`);
}

// The counters are rendered as shields.io "dynamic/json" badges that call the
// GitHub search API themselves, so they stay correct even when GitHub throttles
// this workflow's schedule (low-activity repositories are delayed by hours). A
// static shields badge would freeze whatever count the last run happened to see.
function dynamicBadge(label, query, color) {
  const target = `https://api.github.com/search/issues?q=${encodeURIComponent(
    query,
  ).replace(/%20/g, '+')}&per_page=1`;
  const params = new URLSearchParams({
    url: target,
    query: '$.total_count',
    label,
    color,
  });
  return `![${label}](https://img.shields.io/badge/dynamic/json?${params})`;
}

const merged = await search(`author:${username} type:pr is:merged`);
const open = await search(`author:${username} type:pr is:open`);
const all = await search(`author:${username} type:pr`, 1);

const stats = [
  dynamicBadge('Merged PRs', `author:${username} type:pr is:merged`, 'brightgreen'),
  dynamicBadge('Open PRs', `author:${username} type:pr is:open`, 'blue'),
  dynamicBadge('Total PRs', `author:${username} type:pr`, 'lightgrey'),
].join('\n');

let readme = await readFile(readmePath, 'utf8');
readme = replaceSection(readme, 'prstats', stats);
readme = replaceSection(readme, 'prlist', renderList(merged.items));
readme = replaceSection(readme, 'openprlist', renderList(open.items));
await writeFile(readmePath, readme, 'utf8');

console.log(
  `Updated ${readmePath}: merged=${merged.total_count}, open=${open.total_count}, total=${all.total_count}`,
);