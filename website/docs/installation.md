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
npm install @microde/application
```

</TabItem>
<TabItem value="rust" label="Rust">

```bash
cargo add microde-application
```

</TabItem>
</Tabs>

If you prefer to edit dependencies manually, add `microde-application` to the
`[dependencies]` table in `Cargo.toml`.

Microde is published as an ECMAScript module and includes TypeScript declarations. Use it from an ESM-compatible Node.js project:

<Tabs groupId="language">
<TabItem value="typescript" label="TypeScript">

```ts
import { MicrodeApplication } from '@microde/application';
```

</TabItem>
<TabItem value="rust" label="Rust">

```rust
use microde_application::MicrodeApplication;
```

</TabItem>
</Tabs>

See [Compatibility and limitations](./compatibility.md) before adopting a pre-1.0
release in production.
