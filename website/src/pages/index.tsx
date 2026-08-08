import type { ReactNode } from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';

import styles from './index.module.css';

export default function Home(): ReactNode {
	const { siteConfig } = useDocusaurusContext();

	return (
		<Layout
			title={siteConfig.title}
			description="Microde is a composition-based TypeScript framework for long-running microservices."
		>
			<main>
				<section className={clsx('hero', styles.hero)}>
					<div className="container">
						<p className={styles.eyebrow}>Composable by design</p>
						<Heading as="h1" className={styles.title}>
							Microservices with a lifecycle you can reason about.
						</Heading>
						<p className={styles.subtitle}>{siteConfig.tagline}</p>
						<div className={styles.actions}>
							<Link
								className="button button--primary button--lg"
								to="/docs/quick-start"
							>
								Get started
							</Link>
							<Link
								className="button button--secondary button--lg"
								to="/docs/api"
							>
								Explore the API
							</Link>
						</div>
					</div>
				</section>
				<section className={styles.features}>
					<div className="container">
						<div className="row">
							<Feature title="Explicit lifecycle">
								Initialize, set up, run, and unwind modules
								through predictable phases.
							</Feature>
							<Feature title="Composition first">
								Build a service from focused active and passive
								modules.
							</Feature>
							<Feature title="Orderly failure">
								Preserve errors while teardown, shutdown, and
								cleanup still get a chance to run.
							</Feature>
						</div>
					</div>
				</section>
			</main>
		</Layout>
	);
}

function Feature({
	title,
	children,
}: {
	title: string;
	children: ReactNode;
}): ReactNode {
	return (
		<div className="col col--4">
			<div className={styles.feature}>
				<Heading as="h2">{title}</Heading>
				<p>{children}</p>
			</div>
		</div>
	);
}
