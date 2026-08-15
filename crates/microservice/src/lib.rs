#![doc = include_str!("../README.md")]

mod context;
mod error;
mod execution_result;
mod microservice;
mod module;
mod runtime;
mod stop_request;
mod types;

pub use context::{MicroserviceContext, MicroserviceContextHandle};
pub use error::MicroserviceError;
pub use execution_result::MicroserviceExecutionResult;
pub use microservice::Microservice;
pub use module::{MicroserviceModule, ModuleFuture};
pub use stop_request::MicroserviceStopRequest;
pub use types::{MicroserviceState, ModuleKind};
