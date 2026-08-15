---
title: RelationshipDescriptor
---

# `RelationshipDescriptor`

Opaque metadata describing one relationship slot. Modules return descriptors from `MicroserviceModule::relationships` so the runtime can validate and wire their composition.

Create descriptors through `RelationshipSlot::descriptor`, normally by mapping over a module's `Dependency` and `Reference` fields. The descriptor's fields are intentionally private.
