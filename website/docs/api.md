---
title: API reference
description: API reference for the Microde TypeScript package and Rust crate.
---

# API reference

Microde provides matching composition and lifecycle runtimes for TypeScript and
Rust. Choose the package or crate used by your application.

## Packages and crates

<div className="row">
  <div className="col col--6 margin-bottom--lg">
    <div className="card height--100">
      <div className="card__header">
        <h2>TypeScript</h2>
      </div>
		<div className="card__body">
			<div>
				<code>@microde/microservice</code> for Node.js applications.
			</div>
      </div>
      <div className="card__footer">
        <a className="button button--primary button--block" href="./typescript-api">
          TypeScript API reference
        </a>
      </div>
    </div>
  </div>
  <div className="col col--6 margin-bottom--lg">
    <div className="card height--100">
      <div className="card__header">
        <h2>Rust</h2>
      </div>
		<div className="card__body">
			<div>
				<code>microde-microservice</code> with Rust-native traits, futures,
				and errors.
			</div>
      </div>
      <div className="card__footer">
        <a className="button button--primary button--block" href="./rust-api">
          Rust API reference
        </a>
      </div>
    </div>
  </div>
</div>

Both implementations use the same lifecycle and composition model, while their
APIs follow the conventions of their respective languages.
