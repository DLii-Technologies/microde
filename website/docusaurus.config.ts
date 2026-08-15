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

	onBrokenLinks: 'throw',
	markdown: {
		hooks: {
			onBrokenMarkdownLinks: 'throw',
		},
	},

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
					to: '/docs/api',
					position: 'left',
					label: 'API',
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
						{ label: 'Release notes', to: '/docs/releases/0.1.0' },
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
