use std::collections::{BTreeMap, BTreeSet};

use crate::{MicrodeError, ModuleInstanceId};

pub(crate) struct DependencyGraph {
    dependencies: BTreeMap<ModuleInstanceId, BTreeSet<ModuleInstanceId>>,
}

impl DependencyGraph {
    pub(crate) fn new(ids: Vec<ModuleInstanceId>) -> Self {
        Self {
            dependencies: ids.into_iter().map(|id| (id, BTreeSet::new())).collect(),
        }
    }

    #[cfg(test)]
    pub(crate) fn add_dependency(
        &mut self,
        consumer: &str,
        dependency: &str,
    ) -> Result<(), MicrodeError> {
        let consumer = self.find(consumer)?;
        let dependency = self.find(dependency)?;
        self.dependencies
            .get_mut(&consumer)
            .expect("validated consumer exists")
            .insert(dependency);
        Ok(())
    }

    pub(crate) fn add_validated_dependency(
        &mut self,
        consumer: &ModuleInstanceId,
        dependency: &ModuleInstanceId,
    ) {
        self.dependencies
            .entry(consumer.clone())
            .or_default()
            .insert(dependency.clone());
    }

    pub(crate) fn order(&self) -> Result<Vec<ModuleInstanceId>, MicrodeError> {
        let mut ordered = Vec::new();
        let mut completed = BTreeSet::new();
        let mut active = Vec::new();
        for id in self.dependencies.keys() {
            self.visit(id, &mut active, &mut completed, &mut ordered)?;
        }
        Ok(ordered)
    }

    fn visit(
        &self,
        id: &ModuleInstanceId,
        active: &mut Vec<ModuleInstanceId>,
        completed: &mut BTreeSet<ModuleInstanceId>,
        ordered: &mut Vec<ModuleInstanceId>,
    ) -> Result<(), MicrodeError> {
        if completed.contains(id) {
            return Ok(());
        }
        if let Some(start) = active.iter().position(|candidate| candidate == id) {
            let cycle = active[start..]
                .iter()
                .chain(std::iter::once(id))
                .map(ModuleInstanceId::as_str)
                .collect::<Vec<_>>()
                .join(" -> ");
            return Err(MicrodeError::new(format!(
                "dependency cycle detected: {cycle}"
            )));
        }
        active.push(id.clone());
        for dependency in self
            .dependencies
            .get(id)
            .expect("visited module exists in graph")
        {
            self.visit(dependency, active, completed, ordered)?;
        }
        active.pop();
        completed.insert(id.clone());
        ordered.push(id.clone());
        Ok(())
    }

    #[cfg(test)]
    fn find(&self, value: &str) -> Result<ModuleInstanceId, MicrodeError> {
        self.dependencies
            .keys()
            .find(|id| id.as_str() == value)
            .cloned()
            .ok_or_else(|| MicrodeError::new(format!("unknown module instance ID '{value}'")))
    }
}

#[cfg(test)]
mod tests {
    use super::DependencyGraph;
    use crate::ModuleInstanceId;

    fn ids(values: &[&str]) -> Vec<ModuleInstanceId> {
        values
            .iter()
            .map(|value| ModuleInstanceId::new(*value))
            .collect()
    }

    #[test]
    fn orders_empty_and_unrelated_graphs_deterministically() {
        assert_eq!(DependencyGraph::new(vec![]).order().unwrap(), vec![]);
        assert_eq!(
            DependencyGraph::new(ids(&["z", "a", "m"])).order().unwrap(),
            ids(&["a", "m", "z"])
        );
    }

    #[test]
    fn orders_a_diamond_dependency_first() {
        let mut graph = DependencyGraph::new(ids(&["a", "b", "c", "d"]));
        graph.add_dependency("a", "b").unwrap();
        graph.add_dependency("a", "c").unwrap();
        graph.add_dependency("b", "d").unwrap();
        graph.add_dependency("c", "d").unwrap();
        assert_eq!(graph.order().unwrap(), ids(&["d", "b", "c", "a"]));
    }

    #[test]
    fn rejects_unknown_nodes_and_cycles_with_stable_diagnostics() {
        let mut graph = DependencyGraph::new(ids(&["a", "b", "c"]));
        assert_eq!(
            graph
                .add_dependency("missing", "a")
                .unwrap_err()
                .to_string(),
            "unknown module instance ID 'missing'"
        );
        assert_eq!(
            graph
                .add_dependency("a", "missing")
                .unwrap_err()
                .to_string(),
            "unknown module instance ID 'missing'"
        );
        graph.add_dependency("a", "b").unwrap();
        graph.add_dependency("b", "c").unwrap();
        graph.add_dependency("c", "a").unwrap();
        assert_eq!(
            graph.order().unwrap_err().to_string(),
            "dependency cycle detected: a -> b -> c -> a"
        );
    }

    #[test]
    fn rejects_self_dependencies() {
        let mut graph = DependencyGraph::new(ids(&["worker"]));
        graph.add_dependency("worker", "worker").unwrap();
        assert_eq!(
            graph.order().unwrap_err().to_string(),
            "dependency cycle detected: worker -> worker"
        );
    }
}
