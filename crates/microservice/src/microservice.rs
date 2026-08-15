use std::collections::HashSet;
use std::future::Future;
use std::panic::AssertUnwindSafe;
use std::pin::Pin;
use std::sync::{Arc, Mutex};

use futures::future::{BoxFuture, FutureExt, join_all, ready};
use futures::stream::{FuturesUnordered, StreamExt};

use crate::runtime::{
    ErrorPriority, ErrorRecorder, InstalledModule, ModuleStage, RuntimeContext, RuntimeControl,
    spawn, terminate_process,
};
use crate::{
    ActiveMicroserviceModule, MicroserviceContextHandle, MicroserviceError,
    MicroserviceExecutionResult, MicroserviceModule, MicroserviceState, MicroserviceStopRequest,
    ModuleKind,
};
#[cfg(test)]
use crate::{MicroserviceContext, ModuleFuture};

#[derive(Debug, Default, PartialEq, Eq)]
pub(crate) struct ModuleExecutionErrors {
    pub(crate) execution: Vec<MicroserviceError>,
    pub(crate) stop: Vec<MicroserviceError>,
}

type ModuleRunFuture = Pin<
    Box<dyn Future<Output = (usize, ModuleKind, Result<(), MicroserviceError>)> + Send + 'static>,
>;

/// Composes modules and coordinates their lifecycle.
pub struct Microservice {
    pub(crate) modules: Vec<InstalledModule>,
    pub(crate) context: MicroserviceContextHandle,
    pub(crate) control: Arc<RuntimeControl>,
    pub(crate) current_state: Arc<Mutex<MicroserviceState>>,
}

struct InstallationStateReset(Arc<Mutex<MicroserviceState>>);

impl Drop for InstallationStateReset {
    fn drop(&mut self) {
        *self
            .0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = MicroserviceState::Idle;
    }
}

impl Microservice {
    /// Creates an idle microservice with the production module context.
    pub fn new() -> Self {
        let control = Arc::new(RuntimeControl::default());
        let current_state = Arc::new(Mutex::new(MicroserviceState::Idle));
        let context = Arc::new(RuntimeContext::new(
            control.clone(),
            current_state.clone(),
            terminate_process,
        ));
        Self {
            modules: Vec::new(),
            context,
            control,
            current_state,
        }
    }

    #[cfg(test)]
    pub(crate) fn with_context(context: MicroserviceContextHandle) -> Self {
        Self::with_context_and_control(context, Arc::new(RuntimeControl::default()))
    }

    #[cfg(test)]
    pub(crate) fn with_context_and_control(
        context: MicroserviceContextHandle,
        control: Arc<RuntimeControl>,
    ) -> Self {
        Self {
            modules: Vec::new(),
            context,
            control,
            current_state: Arc::new(Mutex::new(MicroserviceState::Idle)),
        }
    }

    pub fn state(&self) -> MicroserviceState {
        *self
            .current_state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    pub fn install_passive<Module, Factory>(
        &mut self,
        factory: Factory,
    ) -> Result<(), MicroserviceError>
    where
        Module: MicroserviceModule + 'static,
        Factory: FnOnce(MicroserviceContextHandle) -> Module,
    {
        match self.ensure_installable() {
            Ok(()) => {}
            Err(error) => return Err(error),
        }
        self.set_state(MicroserviceState::Installing);
        let module = {
            let reset = InstallationStateReset(self.current_state.clone());
            let module = factory(self.context.clone());
            drop(reset);
            module
        };
        self.modules.push(InstalledModule::passive(module));
        Ok(())
    }

    pub fn install_active<Module, Factory>(
        &mut self,
        factory: Factory,
    ) -> Result<(), MicroserviceError>
    where
        Module: ActiveMicroserviceModule + 'static,
        Factory: FnOnce(MicroserviceContextHandle) -> Module,
    {
        match self.ensure_installable() {
            Ok(()) => {}
            Err(error) => return Err(error),
        }
        self.set_state(MicroserviceState::Installing);
        let module = {
            let reset = InstallationStateReset(self.current_state.clone());
            let module = factory(self.context.clone());
            drop(reset);
            module
        };
        self.modules.push(InstalledModule::active(module));
        Ok(())
    }

    fn ensure_installable(&self) -> Result<(), MicroserviceError> {
        if self.state() == MicroserviceState::Idle {
            return Ok(());
        }

        Err(MicroserviceError::new(format!(
            "cannot install module after microservice has started; current state: {:?}",
            self.state()
        )))
    }

    pub(crate) fn set_state(&self, state: MicroserviceState) {
        *self
            .current_state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = state;
    }

    /// Starts the lifecycle immediately and returns an owned future for its final result.
    ///
    /// The lifecycle continues if the returned future is dropped. Any later call to [`Self::stop`]
    /// receives the same shared completion result.
    pub fn run(
        &mut self,
    ) -> BoxFuture<'static, Result<MicroserviceExecutionResult, MicroserviceError>> {
        if self.state() != MicroserviceState::Idle {
            return ready(Err(MicroserviceError::new(format!(
                "cannot run microservice more than once; current state: {:?}",
                self.state()
            ))))
            .boxed();
        }

        self.set_state(MicroserviceState::Initialization);
        let mut runner = Self {
            modules: std::mem::take(&mut self.modules),
            context: self.context.clone(),
            control: self.control.clone(),
            current_state: self.current_state.clone(),
        };

        let control = runner.control.clone();
        let completion = control.clone();
        spawn(async move {
            let result = AssertUnwindSafe(runner.execute_lifecycle())
                .catch_unwind()
                .await
                .map_err(|panic| {
                    runner.set_state(MicroserviceState::Failed);
                    MicroserviceError::new(panic_message(panic))
                });
            control.complete(result);
        });

        async move { completion.wait_for_completion().await }.boxed()
    }

    /// Requests an orderly stop and waits for lifecycle completion.
    pub fn stop(
        &self,
        request: MicroserviceStopRequest,
    ) -> BoxFuture<'static, Result<MicroserviceExecutionResult, MicroserviceError>> {
        let state = self.state();
        if matches!(
            state,
            MicroserviceState::Idle | MicroserviceState::Installing
        ) {
            return ready(Err(MicroserviceError::new(format!(
                "cannot stop microservice before it has started; current state: {state:?}"
            ))))
            .boxed();
        }

        self.control.request_stop(request);
        let control = self.control.clone();
        async move { control.wait_for_completion().await }.boxed()
    }

    async fn execute_lifecycle(&mut self) -> MicroserviceExecutionResult {
        let mut errors = ErrorRecorder::default();
        let mut forward_failed = false;

        if let Err(error) = self.initialize_modules().await {
            errors.record(error, ErrorPriority::Lifecycle);
            forward_failed = true;
        }

        if !forward_failed && !self.control.stop_requested() {
            self.set_state(MicroserviceState::Setup);
            if let Err(error) = self.setup_modules().await {
                errors.record(error, ErrorPriority::Lifecycle);
                forward_failed = true;
            }
        }

        if !forward_failed && !self.control.stop_requested() {
            self.set_state(MicroserviceState::Running);
            let execution_errors = self.execute_modules().await;
            for error in execution_errors.execution {
                errors.record(error, ErrorPriority::Execution);
            }
            for error in execution_errors.stop {
                errors.record(error, ErrorPriority::Stop);
            }
        }

        self.set_state(MicroserviceState::TearDown);
        for error in self.teardown_modules().await {
            errors.record(error, ErrorPriority::Lifecycle);
        }

        self.set_state(MicroserviceState::Shutdown);
        for error in self.shutdown_modules().await {
            errors.record(error, ErrorPriority::Lifecycle);
        }

        self.set_state(MicroserviceState::CleanUp);
        for error in self.cleanup_modules().await {
            errors.record(error, ErrorPriority::Lifecycle);
        }

        let stop_request = self.control.stop_request();
        let exit_code = stop_request.as_ref().and_then(|request| request.exit_code);
        if let Some(error) = stop_request.and_then(|request| request.error) {
            errors.record(error, ErrorPriority::StopRequest);
        }

        let result = errors.into_result(exit_code);
        if result.error.is_some() || result.exit_code != 0 {
            self.set_state(MicroserviceState::Failed);
        } else {
            self.set_state(MicroserviceState::Finished);
        }
        result
    }

    pub(crate) async fn initialize_modules(&mut self) -> Result<(), MicroserviceError> {
        for installed in &mut self.modules {
            if self.control.stop_requested() {
                break;
            }

            installed.set_stage(ModuleStage::Initializing);
            match installed.initialize().await {
                Ok(()) => installed.set_stage(ModuleStage::Initialized),
                Err(error) => return Err(error),
            }
        }
        Ok(())
    }

    pub(crate) async fn setup_modules(&mut self) -> Result<(), MicroserviceError> {
        for installed in &mut self.modules {
            if self.control.stop_requested() {
                break;
            }

            installed.set_stage(ModuleStage::SettingUp);
            match installed.setup().await {
                Ok(()) => installed.set_stage(ModuleStage::SetUp),
                Err(error) => return Err(error),
            }
        }
        Ok(())
    }

    pub(crate) async fn execute_modules(&mut self) -> ModuleExecutionErrors {
        let mut errors = ModuleExecutionErrors::default();
        let has_active = self
            .modules
            .iter()
            .any(|module| module.kind() == ModuleKind::Active);
        let mut runs: FuturesUnordered<ModuleRunFuture> = FuturesUnordered::new();

        for (index, installed) in self.modules.iter_mut().enumerate() {
            installed.set_stage(ModuleStage::Executing);
            let kind = installed.kind();
            let run = installed.run();
            runs.push(Box::pin(async move { (index, kind, run.await) }));
        }

        if !has_active {
            while let Some(outcome) = runs.next().await {
                self.record_run_completion(outcome, &mut errors);
            }
            return errors;
        }

        let stop_signal = self.control.take_stop_receiver().fuse();
        futures::pin_mut!(stop_signal);

        loop {
            futures::select_biased! {
                _ = stop_signal => break,
                outcome = runs.next().fuse() => {
                    let (index, kind, result) = outcome
                        .expect("an installed active module keeps the run stream open");
                    let should_stop = kind == ModuleKind::Active || result.is_err();
                    self.record_run_completion((index, kind, result), &mut errors);
                    if should_stop {
                        break;
                    }
                }
            }
        }

        let active_indexes = self
            .modules
            .iter()
            .enumerate()
            .rev()
            .filter_map(|(index, module)| (module.kind() == ModuleKind::Active).then_some(index))
            .collect::<Vec<_>>();
        let mut stop_futures = Vec::with_capacity(active_indexes.len());
        for index in active_indexes {
            let stop = self.modules[index]
                .stop()
                .expect("active installed modules always provide stop");
            stop_futures.push(async move { (index, stop.await) });
        }

        let mut required_completions = self
            .modules
            .iter()
            .enumerate()
            .filter_map(|(index, module)| {
                (module.kind() == ModuleKind::Passive && module.stage() != ModuleStage::Executed)
                    .then_some(index)
            })
            .collect::<HashSet<_>>();

        for (index, result) in join_all(stop_futures).await {
            match result {
                Ok(()) => {
                    if self.modules[index].stage() != ModuleStage::Executed {
                        required_completions.insert(index);
                    }
                }
                Err(error) => errors.stop.push(error),
            }
        }

        while !required_completions.is_empty() {
            let outcome = runs
                .next()
                .await
                .expect("required module completions have corresponding run futures");
            required_completions.remove(&outcome.0);
            self.record_run_completion(outcome, &mut errors);
        }

        // JavaScript promises continue running even when the lifecycle no longer awaits them.
        // Preserve that behavior for active runs whose stop operation failed instead of
        // cancelling their futures when `runs` is dropped.
        if !runs.is_empty() {
            spawn(async move { while runs.next().await.is_some() {} });
        }

        errors
    }

    fn record_run_completion(
        &mut self,
        (index, _kind, result): (usize, ModuleKind, Result<(), MicroserviceError>),
        errors: &mut ModuleExecutionErrors,
    ) {
        self.modules[index].set_stage(ModuleStage::Executed);
        if let Err(error) = result {
            errors.execution.push(error);
        }
    }

    pub(crate) async fn teardown_modules(&mut self) -> Vec<MicroserviceError> {
        let mut errors = Vec::new();
        for installed in self.modules.iter_mut().rev() {
            if installed.stage() < ModuleStage::SettingUp
                || installed.stage() >= ModuleStage::TearingDown
            {
                continue;
            }

            installed.set_stage(ModuleStage::TearingDown);
            if let Err(error) = installed.teardown().await {
                errors.push(error);
            }
            installed.set_stage(ModuleStage::TornDown);
        }
        errors
    }

    pub(crate) async fn shutdown_modules(&mut self) -> Vec<MicroserviceError> {
        let mut errors = Vec::new();
        for installed in self.modules.iter_mut().rev() {
            if installed.stage() < ModuleStage::Initializing
                || installed.stage() >= ModuleStage::ShuttingDown
            {
                continue;
            }

            installed.set_stage(ModuleStage::ShuttingDown);
            if let Err(error) = installed.shutdown().await {
                errors.push(error);
            }
            installed.set_stage(ModuleStage::Shutdown);
        }
        errors
    }

    pub(crate) async fn cleanup_modules(&mut self) -> Vec<MicroserviceError> {
        let mut errors = Vec::new();
        for installed in self.modules.iter_mut().rev() {
            installed.set_stage(ModuleStage::CleaningUp);
            if let Err(error) = installed.cleanup().await {
                errors.push(error);
            }
            installed.set_stage(ModuleStage::CleanedUp);
        }
        errors
    }
}

impl Default for Microservice {
    fn default() -> Self {
        Self::new()
    }
}

fn panic_message(panic: Box<dyn std::any::Any + Send>) -> String {
    if let Some(message) = panic.downcast_ref::<&str>() {
        return (*message).to_owned();
    }
    if let Some(message) = panic.downcast_ref::<String>() {
        return message.clone();
    }
    "microservice lifecycle panicked".to_owned()
}

#[cfg(test)]
#[path = "tests/execution.rs"]
mod execution_tests;
#[cfg(test)]
#[path = "tests/initialization_and_setup.rs"]
mod initialization_and_setup_tests;
#[cfg(test)]
#[path = "tests/installation.rs"]
mod installation_tests;
#[cfg(test)]
#[path = "tests/public_runtime.rs"]
mod public_runtime_tests;
#[cfg(test)]
#[path = "tests/unwind.rs"]
mod unwind_tests;
