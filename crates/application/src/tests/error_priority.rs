use super::*;

#[test]
fn errors_are_ordered_by_priority_then_sequence() {
    let mut recorder = ErrorRecorder::default();
    recorder.record(
        MicrodeError::new("lifecycle first"),
        ErrorPriority::Lifecycle,
    );
    recorder.record(
        MicrodeError::new("execution first"),
        ErrorPriority::Execution,
    );
    recorder.record(MicrodeError::new("stop first"), ErrorPriority::Stop);
    recorder.record(
        MicrodeError::new("execution second"),
        ErrorPriority::Execution,
    );
    recorder.record(
        MicrodeError::new("stop request"),
        ErrorPriority::StopRequest,
    );
    recorder.record(MicrodeError::new("stop second"), ErrorPriority::Stop);

    let result = recorder.into_result(None);

    assert_eq!(result.exit_code, 1);
    assert_eq!(result.error, Some(MicrodeError::new("stop request")));
    assert_eq!(
        result.errors,
        Some(vec![
            MicrodeError::new("stop request"),
            MicrodeError::new("stop first"),
            MicrodeError::new("stop second"),
            MicrodeError::new("execution first"),
            MicrodeError::new("execution second"),
            MicrodeError::new("lifecycle first"),
        ])
    );
}

#[test]
fn a_single_error_becomes_primary_without_a_redundant_error_list() {
    let mut recorder = ErrorRecorder::default();
    recorder.record(MicrodeError::new("only failure"), ErrorPriority::Lifecycle);

    assert_eq!(
        recorder.into_result(Some(8)),
        MicrodeExecutionResult {
            exit_code: 8,
            error: Some(MicrodeError::new("only failure")),
            errors: None,
        }
    );
}

#[test]
fn success_defaults_to_zero_and_preserves_explicit_exit_codes() {
    assert_eq!(
        ErrorRecorder::default().into_result(None),
        MicrodeExecutionResult {
            exit_code: 0,
            error: None,
            errors: None,
        }
    );
    assert_eq!(
        ErrorRecorder::default().into_result(Some(5)),
        MicrodeExecutionResult {
            exit_code: 5,
            error: None,
            errors: None,
        }
    );
}
