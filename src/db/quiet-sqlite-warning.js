// node:sqlite still prints an ExperimentalWarning on Node 22/24. It is the
// only one we silence; every other warning goes through untouched.
const original = process.emitWarning
process.emitWarning = function (warning, ...args) {
  const text = typeof warning === 'string' ? warning : warning?.message
  const type = typeof args[0] === 'string' ? args[0] : args[0]?.type
  if (type === 'ExperimentalWarning' && /SQLite/i.test(text || '')) return
  return original.call(process, warning, ...args)
}
