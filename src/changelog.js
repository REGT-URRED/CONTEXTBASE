const HEADER = '## Cambios Realizados';
const ENTRY_RE = /^- \[/;

/**
 * Inserta una entrada al inicio de 'Cambios Realizados' y rota las mas antiguas
 * cuando se supera el limite, para que la bitacora no infle el contexto.
 * Devuelve el contenido nuevo y las entradas rotadas (vacio si no hubo rotacion).
 */
export function appendEntry(content, entry, limit = 500) {
  const newline = content.includes('\r\n') ? '\r\n' : '\n';
  const linesArr = content.split(/\r?\n/);
  const headerIndex = linesArr.findIndex(l => l.trim() === HEADER);

  if (headerIndex === -1) {
    return { content: HEADER + newline + entry + newline + newline + content, rotated: [] };
  }

  let sectionEnd = linesArr.findIndex((l, i) => i > headerIndex && /^## /.test(l));
  if (sectionEnd === -1) sectionEnd = linesArr.length;

  const section = linesArr.slice(headerIndex + 1, sectionEnd);
  const entries = section.filter(l => ENTRY_RE.test(l));
  const other = section.filter(l => !ENTRY_RE.test(l));

  const allEntries = [entry, ...entries];
  const keep = allEntries.slice(0, limit);
  const rotated = allEntries.slice(limit);

  const newSection = [HEADER, ...keep, ...other];
  const updated = [...linesArr.slice(0, headerIndex), ...newSection, ...linesArr.slice(sectionEnd)];

  return { content: updated.join(newline), rotated };
}

/**
 * Cuerpo del archivo de archivo historico para las entradas rotadas.
 */
export function archiveBody(rotated) {
  const year = new Date().toISOString().slice(0, 4);
  const header = '# Bitacora Archivada (' + year + ')';
  const note = '> Entradas rotadas automaticamente para mantener liviano el contexto de agentes.';
  return [header, '', note, '', HEADER, '', ...rotated, ''].join('\n');
}
