---
sidebar_position: 1
slug: /
title: Introduction
description: Learn what Microde provides and how its lifecycle model works.
---

# Microde

Microde is a TypeScript framework for composing long-running microservices from small modules with explicit lifecycle boundaries.

Instead of concentrating startup, execution, and shutdown logic in one entry point, a Microde service installs modules. Each module declares how it initializes, connects to the service, runs, and releases its resources. The framework coordinates those phases and preserves failures while the service unwinds.

## When Microde fits

Microde is designed for services that:

- own resources that must start and stop in a predictable order;
- combine background workers, servers, connections, or other long-running components;
- need cleanup to run even when startup or execution fails; and
- benefit from keeping component lifecycle logic self-contained.

The initial `0.1.0` release focuses on lifecycle composition. It does not provide transports, dependency injection, configuration loading, logging, or deployment infrastructure.

## Start here

Follow [Installation](./installation.md), then build a minimal service in the [Quick start](./quick-start.md). The [Core concepts](./core-concepts.md) page explains how active and passive modules differ.
