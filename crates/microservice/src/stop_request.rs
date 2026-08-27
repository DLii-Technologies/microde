use crate::MicrodeError;

/// A non-blocking request for orderly lifecycle termination.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct MicrodeStopRequest {
    pub exit_code: Option<i32>,
    pub error: Option<MicrodeError>,
}

impl MicrodeStopRequest {
    pub const fn success() -> Self {
        Self {
            exit_code: None,
            error: None,
        }
    }

    pub const fn with_exit_code(exit_code: i32) -> Self {
        Self {
            exit_code: Some(exit_code),
            error: None,
        }
    }

    pub fn with_error(error: MicrodeError) -> Self {
        Self {
            exit_code: None,
            error: Some(error),
        }
    }

    pub fn with_exit_code_and_error(exit_code: i32, error: MicrodeError) -> Self {
        Self {
            exit_code: Some(exit_code),
            error: Some(error),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn constructors_capture_each_supported_shape() {
        let error = MicrodeError::new("stop failed");

        assert_eq!(MicrodeStopRequest::success(), MicrodeStopRequest::default());
        assert_eq!(
            MicrodeStopRequest::with_exit_code(42),
            MicrodeStopRequest {
                exit_code: Some(42),
                error: None,
            }
        );
        assert_eq!(
            MicrodeStopRequest::with_error(error.clone()),
            MicrodeStopRequest {
                exit_code: None,
                error: Some(error.clone()),
            }
        );
        assert_eq!(
            MicrodeStopRequest::with_exit_code_and_error(7, error.clone()),
            MicrodeStopRequest {
                exit_code: Some(7),
                error: Some(error),
            }
        );
    }
}
