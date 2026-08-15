use crate::MicroserviceError;

/// The outcome returned after a microservice finishes its lifecycle.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MicroserviceExecutionResult {
    /// The suggested process exit code.
    pub exit_code: i32,
    /// The highest-priority lifecycle error, when one occurred.
    pub error: Option<MicroserviceError>,
    /// Every lifecycle error in priority order when more than one occurred.
    pub errors: Option<Vec<MicroserviceError>>,
}
