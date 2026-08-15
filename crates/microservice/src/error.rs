use std::error::Error;
use std::fmt::{self, Display, Formatter};

/// An owned error that can cross the runtime's concurrency boundaries.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MicroserviceError {
    message: String,
}

impl MicroserviceError {
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl Display for MicroserviceError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl Error for MicroserviceError {}
