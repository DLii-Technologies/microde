use crate::{MicrodeError, MicrodeExecutionResult};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum ErrorPriority {
    Lifecycle,
    Execution,
    Stop,
    StopRequest,
}

struct RecordedError {
    error: MicrodeError,
    priority: ErrorPriority,
    sequence: u64,
}

#[derive(Default)]
pub(crate) struct ErrorRecorder {
    errors: Vec<RecordedError>,
    next_sequence: u64,
}

impl ErrorRecorder {
    pub(crate) fn record(&mut self, error: MicrodeError, priority: ErrorPriority) {
        self.errors.push(RecordedError {
            error,
            priority,
            sequence: self.next_sequence,
        });
        self.next_sequence += 1;
    }

    pub(crate) fn into_result(mut self, exit_code: Option<i32>) -> MicrodeExecutionResult {
        if self.errors.is_empty() {
            return MicrodeExecutionResult {
                exit_code: exit_code.unwrap_or(0),
                error: None,
                errors: None,
            };
        }

        self.errors.sort_by(|left, right| {
            right
                .priority
                .cmp(&left.priority)
                .then_with(|| left.sequence.cmp(&right.sequence))
        });
        let errors = self
            .errors
            .into_iter()
            .map(|recorded| recorded.error)
            .collect::<Vec<_>>();

        MicrodeExecutionResult {
            exit_code: exit_code.unwrap_or(1),
            error: errors.first().cloned(),
            errors: (errors.len() > 1).then_some(errors),
        }
    }
}

#[cfg(test)]
#[path = "../tests/error_priority.rs"]
mod tests;
