use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::panic::AssertUnwindSafe;
use std::pin::Pin;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use futures::future::{BoxFuture, FutureExt, join_all, pending, ready};
use futures::stream::{FuturesUnordered, StreamExt};

#[cfg(test)]
use crate::MicrodeContext;
use crate::dependency_graph::DependencyGraph;
use crate::lifecycle_context::ResolvedRelationship;
use crate::runtime::{
    ErrorPriority, ErrorRecorder, InstalledModule, ModuleStage, RuntimeContext, RuntimeControl,
    spawn, terminate_process,
};
use crate::{
    MicrodeApplicationState, MicrodeContextHandle, MicrodeError, MicrodeExecutionResult,
    MicrodeModule, MicrodeStopRequest, ModuleFuture, ModuleHandle, ModuleHandleIdentity,
    ModuleInstanceId, ModuleKind, RelationshipKind, RelationshipSlot, RunContext, SetupContext,
};

static NEXT_SERVICE_ID: AtomicU64 = AtomicU64::new(0);

#[derive(Clone)]
struct Binding {
    owner: ModuleInstanceId,
    target: ModuleInstanceId,
    port_id: u64,
    provider: crate::Provider,
}

#[derive(Debug, Default, PartialEq, Eq)]
pub(crate) struct ModuleExecutionErrors {
    pub(crate) execution: Vec<MicrodeError>,
    pub(crate) stop: Vec<MicrodeError>,
}

type ModuleRunFuture =
    Pin<Box<dyn Future<Output = (usize, ModuleKind, Result<(), MicrodeError>)> + Send + 'static>>;

type ApplicationMain = Box<dyn FnOnce(MicrodeContextHandle) -> ModuleFuture + Send + 'static>;

/// Composes modules and coordinates their lifecycle.
pub struct MicrodeApplication {
    pub(crate) modules: Vec<InstalledModule>,
    pub(crate) context: MicrodeContextHandle,
    pub(crate) control: Arc<RuntimeControl>,
    pub(crate) current_state: Arc<Mutex<MicrodeApplicationState>>,
    composition_id: u64,
    bindings: HashMap<u64, Binding>,
    resolutions: HashMap<u64, ResolvedRelationship>,
    composition_sealed: bool,
}

struct InstallationStateReset(Arc<Mutex<MicrodeApplicationState>>);

impl Drop for InstallationStateReset {
    fn drop(&mut self) {
        *self
            .0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = MicrodeApplicationState::Idle;
    }
}

impl MicrodeApplication {
    /// Creates an idle microservice with the production module context.
    pub fn new() -> Self {
        let control = Arc::new(RuntimeControl::default());
        let current_state = Arc::new(Mutex::new(MicrodeApplicationState::Idle));
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
            composition_id: NEXT_SERVICE_ID.fetch_add(1, Ordering::Relaxed),
            bindings: HashMap::new(),
            resolutions: HashMap::new(),
            composition_sealed: false,
        }
    }

    #[cfg(test)]
    pub(crate) fn with_context(context: MicrodeContextHandle) -> Self {
        Self::with_context_and_control(context, Arc::new(RuntimeControl::default()))
    }

    #[cfg(test)]
    pub(crate) fn with_context_and_control(
        context: MicrodeContextHandle,
        control: Arc<RuntimeControl>,
    ) -> Self {
        Self {
            modules: Vec::new(),
            context,
            control,
            current_state: Arc::new(Mutex::new(MicrodeApplicationState::Idle)),
            composition_id: NEXT_SERVICE_ID.fetch_add(1, Ordering::Relaxed),
            bindings: HashMap::new(),
            resolutions: HashMap::new(),
            composition_sealed: false,
        }
    }

    pub fn state(&self) -> MicrodeApplicationState {
        *self
            .current_state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    pub fn install<Module, Factory>(&mut self, factory: Factory) -> Result<(), MicrodeError>
    where
        Module: MicrodeModule + 'static,
        Factory: FnOnce(MicrodeContextHandle) -> Module,
    {
        match self.ensure_installable() {
            Ok(()) => {}
            Err(error) => return Err(error),
        }
        self.set_state(MicrodeApplicationState::Installing);
        let module = {
            let reset = InstallationStateReset(self.current_state.clone());
            let module = factory(self.context.clone());
            drop(reset);
            module
        };
        let id = ModuleInstanceId::new(format!("@installation/{}", self.modules.len()));
        self.modules.push(InstalledModule::new(id, module));
        Ok(())
    }

    pub fn install_named<Module, Factory>(
        &mut self,
        id: impl Into<String>,
        factory: Factory,
    ) -> Result<ModuleHandle<Module>, MicrodeError>
    where
        Module: MicrodeModule + 'static,
        Factory: FnOnce(MicrodeContextHandle) -> Module,
    {
        let id = self.reserve_named_id(id.into())?;
        self.set_state(MicrodeApplicationState::Installing);
        let module = {
            let reset = InstallationStateReset(self.current_state.clone());
            let module = factory(self.context.clone());
            drop(reset);
            module
        };
        let handle = ModuleHandle::new(id.clone(), self.composition_id);
        self.modules.push(InstalledModule::new(id, module));
        Ok(handle)
    }

    fn reserve_named_id(&self, value: String) -> Result<ModuleInstanceId, MicrodeError> {
        self.ensure_installable()?;
        let id = ModuleInstanceId::new(value);
        if self.modules.iter().any(|module| module.id() == &id) {
            return Err(MicrodeError::new(format!(
                "module instance ID '{}' is already installed",
                id.as_str()
            )));
        }
        Ok(id)
    }

    pub fn bind(
        &mut self,
        consumer: &dyn ModuleHandleIdentity,
        slot: &dyn RelationshipSlot,
        target: &dyn ModuleHandleIdentity,
    ) -> Result<(), MicrodeError> {
        self.ensure_installable()?;
        for handle in [
            (consumer.module_instance_id(), consumer.composition_owner()),
            (target.module_instance_id(), target.composition_owner()),
        ] {
            if handle.1 != self.composition_id {
                return Err(MicrodeError::new(format!(
                    "module handle '{}' belongs to another application",
                    handle.0.as_str()
                )));
            }
        }
        let descriptor = slot.descriptor();
        let installed = self
            .modules
            .iter()
            .find(|module| module.id() == consumer.module_instance_id())
            .unwrap();
        if !installed
            .relationships()
            .iter()
            .any(|known| known.slot_id == descriptor.slot_id)
        {
            return Err(MicrodeError::new(format!(
                "unknown relationship '{}.{}'",
                consumer.module_instance_id().as_str(),
                descriptor.name
            )));
        }
        if self.bindings.contains_key(&descriptor.slot_id) {
            return Err(MicrodeError::new(format!(
                "relationship '{}.{}' is already bound",
                consumer.module_instance_id().as_str(),
                descriptor.name
            )));
        }
        let provider = self
            .modules
            .iter()
            .find(|module| module.id() == target.module_instance_id())
            .unwrap();
        if let Some((required, name)) = descriptor.module_type
            && provider.module_type() != required
        {
            return Err(MicrodeError::new(format!(
                "module '{}' does not satisfy concrete module requirement '{}'",
                target.module_instance_id().as_str(),
                name.rsplit("::").next().unwrap_or(name)
            )));
        }
        let Some(exported) = provider
            .providers()
            .iter()
            .find(|known| known.port_id == descriptor.port_id)
        else {
            return Err(MicrodeError::new(format!(
                "module '{}' does not provide port '{}'",
                target.module_instance_id().as_str(),
                descriptor.port_description
            )));
        };
        self.bindings.insert(
            descriptor.slot_id,
            Binding {
                owner: consumer.module_instance_id().clone(),
                target: target.module_instance_id().clone(),
                port_id: descriptor.port_id,
                provider: exported.clone(),
            },
        );
        Ok(())
    }

    fn wire_composition(&mut self) -> Result<(), MicrodeError> {
        let mut graph = DependencyGraph::new(
            self.modules
                .iter()
                .map(|module| module.id().clone())
                .collect(),
        );
        for module in &self.modules {
            for relationship in module.relationships() {
                let binding = self.bindings.get(&relationship.slot_id).ok_or_else(|| {
                    MicrodeError::new(format!(
                        "missing binding for relationship '{}.{}'",
                        module.id().as_str(),
                        relationship.name
                    ))
                })?;
                if relationship.kind == RelationshipKind::Dependency {
                    graph.add_validated_dependency(&binding.owner, &binding.target);
                }
            }
        }
        let order = graph.order()?;
        let mut staged = HashMap::new();
        let mut provider_values: HashMap<
            (ModuleInstanceId, u64),
            Arc<dyn std::any::Any + Send + Sync>,
        > = HashMap::new();
        for module in &self.modules {
            for relationship in module.relationships() {
                let binding = &self.bindings[&relationship.slot_id];
                let provider_key = (binding.target.clone(), binding.port_id);
                let value = match provider_values.get(&provider_key) {
                    Some(value) => value.clone(),
                    None => {
                        let value = binding.provider.resolve()?;
                        provider_values.insert(provider_key, value.clone());
                        value
                    }
                };
                staged.insert(
                    relationship.slot_id,
                    ResolvedRelationship {
                        owner: module.id().clone(),
                        name: relationship.name.clone(),
                        kind: relationship.kind,
                        value,
                    },
                );
            }
        }
        self.modules
            .sort_by_key(|module| order.iter().position(|id| id == module.id()));
        self.resolutions = staged;
        Ok(())
    }

    fn ensure_installable(&self) -> Result<(), MicrodeError> {
        if self.state() != MicrodeApplicationState::Idle {
            return Err(MicrodeError::new(format!(
                "cannot install module after application has started; current state: {:?}",
                self.state()
            )));
        }
        if self.composition_sealed {
            return Err(MicrodeError::new(
                "cannot modify composition after it is sealed",
            ));
        }
        Ok(())
    }

    pub(crate) fn set_state(&self, state: MicrodeApplicationState) {
        *self
            .current_state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = state;
    }

    /// Serves the application using module completion and stop requests to control its lifetime.
    ///
    /// The lifecycle continues if the returned future is dropped. Any later call to [`Self::stop`]
    /// receives the same shared completion result.
    pub fn serve(&mut self) -> BoxFuture<'static, Result<MicrodeExecutionResult, MicrodeError>> {
        self.start(None)
    }

    /// Runs an application-level task after all modules have started.
    ///
    /// Completion or failure of the task begins orderly application shutdown.
    pub fn run<Main, MainFuture>(
        &mut self,
        main: Main,
    ) -> BoxFuture<'static, Result<MicrodeExecutionResult, MicrodeError>>
    where
        Main: FnOnce(MicrodeContextHandle) -> MainFuture + Send + 'static,
        MainFuture: Future<Output = Result<(), MicrodeError>> + Send + 'static,
    {
        self.start(Some(Box::new(move |context| Box::pin(main(context)))))
    }

    fn start(
        &mut self,
        main: Option<ApplicationMain>,
    ) -> BoxFuture<'static, Result<MicrodeExecutionResult, MicrodeError>> {
        if self.state() != MicrodeApplicationState::Idle {
            return ready(Err(MicrodeError::new(format!(
                "cannot start application more than once; current state: {:?}",
                self.state()
            ))))
            .boxed();
        }

        if self.composition_sealed {
            return ready(Err(MicrodeError::new(
                "cannot start application more than once; composition is sealed",
            )))
            .boxed();
        }
        self.composition_sealed = true;

        if let Err(error) = self.wire_composition() {
            return ready(Err(error)).boxed();
        }

        self.set_state(MicrodeApplicationState::Initialization);
        let mut runner = Self {
            modules: std::mem::take(&mut self.modules),
            context: self.context.clone(),
            control: self.control.clone(),
            current_state: self.current_state.clone(),
            composition_id: self.composition_id,
            bindings: std::mem::take(&mut self.bindings),
            resolutions: std::mem::take(&mut self.resolutions),
            composition_sealed: true,
        };

        let control = runner.control.clone();
        let completion = control.clone();
        spawn(async move {
            let result = AssertUnwindSafe(runner.execute_lifecycle(main))
                .catch_unwind()
                .await
                .map_err(|panic| {
                    runner.set_state(MicrodeApplicationState::Failed);
                    MicrodeError::new(panic_message(panic))
                });
            control.complete(result);
        });

        async move { completion.wait_for_completion().await }.boxed()
    }

    /// Requests an orderly stop and waits for lifecycle completion.
    pub fn stop(
        &self,
        request: MicrodeStopRequest,
    ) -> BoxFuture<'static, Result<MicrodeExecutionResult, MicrodeError>> {
        let state = self.state();
        if matches!(
            state,
            MicrodeApplicationState::Idle | MicrodeApplicationState::Installing
        ) {
            return ready(Err(MicrodeError::new(format!(
                "cannot stop application before it has started; current state: {state:?}"
            ))))
            .boxed();
        }

        self.control.request_stop(request);
        let control = self.control.clone();
        async move { control.wait_for_completion().await }.boxed()
    }

    async fn execute_lifecycle(&mut self, main: Option<ApplicationMain>) -> MicrodeExecutionResult {
        let mut errors = ErrorRecorder::default();
        let mut forward_failed = false;

        if let Err(error) = self.initialize_modules().await {
            errors.record(error, ErrorPriority::Lifecycle);
            forward_failed = true;
        }

        if !forward_failed && !self.control.stop_requested() {
            self.set_state(MicrodeApplicationState::Setup);
            if let Err(error) = self.setup_modules().await {
                errors.record(error, ErrorPriority::Lifecycle);
                forward_failed = true;
            }
        }

        if !forward_failed && !self.control.stop_requested() {
            self.set_state(MicrodeApplicationState::Running);
            let execution_errors = self.execute_modules(main).await;
            for error in execution_errors.execution {
                errors.record(error, ErrorPriority::Execution);
            }
            for error in execution_errors.stop {
                errors.record(error, ErrorPriority::Stop);
            }
        }

        self.set_state(MicrodeApplicationState::TearDown);
        for error in self.teardown_modules().await {
            errors.record(error, ErrorPriority::Lifecycle);
        }

        self.set_state(MicrodeApplicationState::Shutdown);
        for error in self.shutdown_modules().await {
            errors.record(error, ErrorPriority::Lifecycle);
        }

        self.set_state(MicrodeApplicationState::CleanUp);
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
            self.set_state(MicrodeApplicationState::Failed);
        } else {
            self.set_state(MicrodeApplicationState::Finished);
        }
        result
    }

    pub(crate) async fn initialize_modules(&mut self) -> Result<(), MicrodeError> {
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

    pub(crate) async fn setup_modules(&mut self) -> Result<(), MicrodeError> {
        let resolutions = Arc::new(self.resolutions.clone());
        for installed in &mut self.modules {
            if self.control.stop_requested() {
                break;
            }

            installed.set_stage(ModuleStage::SettingUp);
            let context = SetupContext::new(installed.id().clone(), resolutions.clone());
            match installed.setup_with_context(context).await {
                Ok(()) => installed.set_stage(ModuleStage::SetUp),
                Err(error) => return Err(error),
            }
        }
        Ok(())
    }

    pub(crate) async fn execute_modules(
        &mut self,
        main: Option<ApplicationMain>,
    ) -> ModuleExecutionErrors {
        let mut errors = ModuleExecutionErrors::default();
        let mut runs: FuturesUnordered<ModuleRunFuture> = FuturesUnordered::new();
        let resolutions = Arc::new(self.resolutions.clone());

        for (index, installed) in self.modules.iter_mut().enumerate() {
            installed.set_stage(ModuleStage::Executing);
            let kind = installed.kind();
            let context = RunContext::new(installed.id().clone(), resolutions.clone());
            let run = installed.run_with_context(context);
            runs.push(Box::pin(async move { (index, kind, run.await) }));
        }

        let stop_signal = self.control.take_stop_receiver().fuse();
        futures::pin_mut!(stop_signal);

        let has_main = main.is_some();
        let main_future = match main {
            Some(main) => main(self.context.clone()).boxed(),
            None => pending::<Result<(), MicrodeError>>().boxed(),
        }
        .fuse();
        futures::pin_mut!(main_future);

        loop {
            if runs.is_empty() {
                if !has_main {
                    break;
                }
                futures::select_biased! {
                    _ = stop_signal => break,
                    result = main_future => {
                        if let Err(error) = result {
                            errors.execution.push(error);
                        }
                        break;
                    }
                }
            }
            futures::select_biased! {
                _ = stop_signal => break,
                result = main_future => {
                    if let Err(error) = result {
                        errors.execution.push(error);
                    }
                    break;
                },
                outcome = runs.next().fuse() => {
                    let (index, kind, result) = outcome
                        .expect("non-empty module runs have a next completion");
                    let should_stop = kind == ModuleKind::Active || result.is_err();
                    self.record_run_completion((index, kind, result), &mut errors);
                    if should_stop {
                        break;
                    }
                }
            }
        }

        let module_indexes = self
            .modules
            .iter()
            .enumerate()
            .rev()
            .map(|(index, _)| index)
            .collect::<Vec<_>>();
        let mut stop_futures = Vec::with_capacity(module_indexes.len());
        for index in module_indexes {
            let stop = self.modules[index].stop();
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
        (index, _kind, result): (usize, ModuleKind, Result<(), MicrodeError>),
        errors: &mut ModuleExecutionErrors,
    ) {
        self.modules[index].set_stage(ModuleStage::Executed);
        if let Err(error) = result {
            errors.execution.push(error);
        }
    }

    pub(crate) async fn teardown_modules(&mut self) -> Vec<MicrodeError> {
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

    pub(crate) async fn shutdown_modules(&mut self) -> Vec<MicrodeError> {
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

    pub(crate) async fn cleanup_modules(&mut self) -> Vec<MicrodeError> {
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

impl Default for MicrodeApplication {
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
    "application lifecycle panicked".to_owned()
}

#[cfg(test)]
#[path = "tests/composition_wiring.rs"]
mod composition_wiring_tests;
#[cfg(test)]
#[path = "tests/dependency_lifecycle.rs"]
mod dependency_lifecycle_tests;
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
