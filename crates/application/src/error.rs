use std::error::Error;
use std::fmt::{self, Display, Formatter};

/// An owned error that can cross the runtime's concurrency boundaries.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MicrodeError {
    message: String,
}

impl MicrodeError {
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl Display for MicrodeError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl Error for MicrodeError {}
