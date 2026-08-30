use crate::MicrodeError;

/// The outcome returned after a application finishes its lifecycle.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MicrodeExecutionResult {
    /// The suggested process exit code.
    pub exit_code: i32,
    /// The highest-priority lifecycle error, when one occurred.
    pub error: Option<MicrodeError>,
    /// Every lifecycle error in priority order when more than one occurred.
    pub errors: Option<Vec<MicrodeError>>,
}
