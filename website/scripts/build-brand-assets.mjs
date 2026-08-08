import { readFile, writeFile } from 'node:fs/promises';

const imageDir = new URL('../static/img/', import.meta.url);
const source = await readFile(new URL('new_logo.svg', imageDir), 'utf8');
const paths = [...source.matchAll(/<path\b[^>]*\/>/g)]
	.map(([path]) => path.trim())
	.join('\n    ');

if (!paths) {
	throw new Error('No paths found in static/img/new_logo.svg');
}

const icon = `<g id="microde-icon">\n    ${paths}\n  </g>`;

await writeFile(
	new URL('favicon.svg', imageDir),
	`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 334 334" role="img" aria-label="Microde">\n  <title>Microde</title>\n  <g transform="translate(10 0)">\n    ${paths}\n  </g>\n</svg>\n`,
);

await writeFile(
	new URL('logo.svg', imageDir),
	`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 314 334" role="img" aria-labelledby="logo-title">\n  <title id="logo-title">Microde</title>\n  ${icon}\n</svg>\n`,
);

await writeFile(
	new URL('social-card.svg', imageDir),
		`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-labelledby="card-title card-description">\n  <title id="card-title">Microde</title>\n  <desc id="card-description">Build. Compose. Distribute.</desc>\n  <rect width="1200" height="630" rx="32" fill="#f7f7f4"/>\n  <path d="M0 0h1200v14H0z" fill="#293445"/>\n  <path d="M0 14h390v7H0z" fill="#fb5c0c"/>\n  <path d="M390 14h245v7H390z" fill="#03bdbf"/>\n  <circle cx="985" cy="315" r="242" fill="#edf3f2"/>\n  <circle cx="985" cy="315" r="194" fill="none" stroke="#dbe7e5" stroke-width="2"/>\n  <path d="M726 512h394" fill="none" stroke="#293445" stroke-linecap="round" stroke-width="8"/>\n  <path d="M726 512h156" fill="none" stroke="#fb5c0c" stroke-linecap="round" stroke-width="8"/>\n  <path d="M882 512h98" fill="none" stroke="#03bdbf" stroke-linecap="round" stroke-width="8"/>\n  <g transform="translate(785 108) scale(1.2739)">\n    ${paths}\n  </g>\n  <text x="88" y="266" fill="#293445" font-family="system-ui, sans-serif" font-size="104" font-weight="750" letter-spacing="-3">Microde</text>\n  <text x="94" y="354" fill="#465465" font-family="system-ui, sans-serif" font-size="36" font-weight="500">Build. Compose. Distribute.</text>\n  <circle cx="98" cy="438" r="8" fill="#fb5c0c"/>\n  <circle cx="126" cy="438" r="8" fill="#03bdbf"/>\n  <path d="M154 438h190" fill="none" stroke="#293445" stroke-linecap="round" stroke-width="4"/>\n</svg>\n`,
);
