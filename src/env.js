/**
 * Criterio unico de "entorno de pruebas".
 *
 * Node.js define NODE_TEST_CONTEXT en los procesos hijos del runner `node --test`.
 * Se usa para impedir que las rutas autonomas (pulso de Telarana, arbitraje, agentes)
 * lancen procesos reales de agentes, que colgarian la suite y dejarian huerfanos.
 *
 * Criterio compartido por src/mcp.js, src/auto.js, src/swarm.js y src/web.js.
 */
export function isTestEnv() {
  return Boolean(process.env.NODE_TEST_CONTEXT) || process.execArgv.includes('--test');
}

/**
 * En entorno de pruebas ningun agente real puede ejecutarse.
 * Los deps inyectados (fakes) siguen funcionando: el bloqueo es solo para deps reales.
 */
export function realAgentsAllowed() {
  return !isTestEnv();
}
