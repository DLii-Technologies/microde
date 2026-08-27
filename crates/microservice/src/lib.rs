#![doc = include_str!("../README.md")]

mod application;
mod composition;
mod context;
mod dependency_graph;
mod error;
mod execution_result;
mod lifecycle_context;
mod module;
mod relationship;
mod runtime;
mod stop_request;
mod types;

pub use application::MicrodeApplication;
pub use composition::{ModuleHandle, ModuleHandleIdentity, ModuleInstanceId};
pub use context::{MicrodeContext, MicrodeContextHandle};
pub use error::MicrodeError;
pub use execution_result::MicrodeExecutionResult;
pub use lifecycle_context::{RunContext, RunRelationship, SetupContext};
pub use module::{MicrodeModule, ModuleFuture};
pub use relationship::{
    Dependency, Port, Provider, Reference, RelationshipDescriptor, RelationshipKind,
    RelationshipSlot,
};
pub use stop_request::MicrodeStopRequest;
pub use types::{MicrodeApplicationState, ModuleKind};
