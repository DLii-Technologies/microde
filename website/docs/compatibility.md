---
title: Compatibility and limitations
---

# Compatibility and limitations

## Module format

`@microde/application` is an ECMAScript module package. Its compiled JavaScript targets ES2022 and its package exports provide ESM imports and TypeScript declarations.

## Runtime

The TypeScript runtime currently depends on Node.js behavior for `process.exit`,
`process.exitCode`, and console output. The package does not yet declare a formal
Node.js engine range.

## API stability

The project is still pre-1.0. Public APIs may evolve as lifecycle patterns are
exercised in production. Changes should be recorded in release notes and follow
semantic versioning within the published compatibility policy.

## Current scope

Microde coordinates module composition and lifecycle. It does not currently include dependency injection, transport adapters, configuration management, structured logging, health checks, or deployment tooling.
