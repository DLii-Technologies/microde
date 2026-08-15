import type { Config } from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';
import { themes as prismThemes } from 'prism-react-renderer';

const config: Config = {
	title: 'Microde',
	tagline: 'Build composable microservices with explicit lifecycles.',
	favicon: 'img/favicon.svg',
	future: {
		v4: true,
	},

	url: 'https://microde.dlii.tech',
	baseUrl: '/',

	// Rustdoc is generated into the static directory during the build, so
	// Docusaurus cannot discover its routes during the Markdown link pass.
	onBrokenLinks: 'warn',
	markdown: {
		mermaid: true,
		hooks: {
			onBrokenMarkdownLinks: 'throw',
		},
	},
	themes: ['@docusaurus/theme-mermaid'],

	i18n: {
		defaultLocale: 'en',
		locales: ['en'],
	},

	presets: [
		[
			'classic',
			{
				docs: {
					routeBasePath: 'docs',
					sidebarPath: './sidebars.ts',
				},
				blog: false,
				theme: {
					customCss: './src/css/custom.css',
				},
			} satisfies Preset.Options,
		],
	],

	themeConfig: {
		image: 'img/social-card.svg',
		mermaid: {
			options: {
				htmlLabels: false,
			},
		},
		navbar: {
			title: 'Microde',
			logo: {
				alt: 'Microde logo',
				src: 'img/logo.svg',
			},
			items: [
				{
					type: 'docSidebar',
					sidebarId: 'guidesSidebar',
					position: 'left',
					label: 'Guides',
				},
				{
					type: 'dropdown',
					position: 'left',
					label: 'API',
					items: [
						{ label: 'API overview', to: '/docs/api' },
						{ label: 'TypeScript API', to: '/docs/typescript-api' },
						{ label: 'Rust API', to: '/docs/rust-api' },
					],
				},
				{
					href: 'https://github.com/DLii-Technologies/microde',
					label: 'GitHub',
					position: 'right',
				},
			],
		},
		footer: {
			style: 'dark',
			links: [
				{
					title: 'Documentation',
					items: [
						{ label: 'Quick start', to: '/docs/quick-start' },
						{ label: 'API reference', to: '/docs/api' },
					],
				},
				{
					title: 'Project',
					items: [
						{
							label: 'GitHub',
							href: 'https://github.com/DLii-Technologies/microde',
						},
					],
				},
			],
			copyright: `Copyright © ${new Date().getFullYear()} DLii Technologies.`,
		},
		prism: {
			theme: prismThemes.github,
			darkTheme: prismThemes.dracula,
			additionalLanguages: ['bash', 'rust'],
		},
	} satisfies Preset.ThemeConfig,
};

export default config;
