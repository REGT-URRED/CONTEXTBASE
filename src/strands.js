// Strands preparation only (phase 1): interface stub, no execution.

export function prepareObjective(projectState) {
  const state = projectState || {};
  return {
    ready: false,
    objective: {
      project: state.project || null,
      pendingTasks: Array.isArray(state.tasks && state.tasks.pending) ? state.tasks.pending : []
    },
    note: 'Strands agent swarms are not implemented in phase 1; interface only.'
  };
}

export function isReady() {
  return false;
}