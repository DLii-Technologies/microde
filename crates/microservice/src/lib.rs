#![doc = include_str!("../README.md")]

mod composition;
mod context;
mod dependency_graph;
mod error;
mod execution_result;
mod lifecycle_context;
mod microservice;
mod module;
mod relationship;
mod runtime;
mod stop_request;
mod types;

pub use composition::{ModuleHandle, ModuleHandleIdentity, ModuleInstanceId};
pub use context::{MicroserviceContext, MicroserviceContextHandle};
pub use error::MicroserviceError;
pub use execution_result::MicroserviceExecutionResult;
pub use lifecycle_context::{RunContext, RunRelationship, SetupContext};
pub use microservice::Microservice;
pub use module::{MicroserviceModule, ModuleFuture};
pub use relationship::{
    Dependency, Port, Provider, Reference, RelationshipDescriptor, RelationshipKind,
    RelationshipSlot,
};
pub use stop_request::MicroserviceStopRequest;
pub use types::{MicroserviceState, ModuleKind};
