---
sidebar_position: 2
title: Installation
---

# Installation

Install the core package with your package manager:

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

<Tabs groupId="language">
<TabItem value="typescript" label="TypeScript">

```bash npm2yarn
npm install @microde/microservice
```

</TabItem>
<TabItem value="rust" label="Rust">

```bash
cargo add microde-microservice
```

</TabItem>
</Tabs>

If you prefer to edit dependencies manually, add `microde-microservice` to the
`[dependencies]` table in `Cargo.toml`.

Microde is published as an ECMAScript module and includes TypeScript declarations. Use it from an ESM-compatible Node.js project:

<Tabs groupId="language">
<TabItem value="typescript" label="TypeScript">

```ts
import { Microservice } from '@microde/microservice';
```

</TabItem>
<TabItem value="rust" label="Rust">

```rust
use microde_microservice::Microservice;
```

</TabItem>
</Tabs>

See [Compatibility and limitations](./compatibility.md) before adopting a pre-1.0
release in production.
