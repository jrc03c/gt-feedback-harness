// Splits argv into a command, its positional arguments, and --flags. A flag
// followed by another flag or by nothing is a boolean.
export function parseArgs(argv) {
  const positional = []
  const flags = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg.startsWith("--")) {
      const name = arg.slice(2)
      const next = argv[i + 1]
      if (next === undefined || next.startsWith("--")) {
        flags[name] = true
      } else {
        flags[name] = next
        i++
      }
    } else {
      positional.push(arg)
    }
  }
  const command = flags.help ? "help" : positional.shift() || "help"
  delete flags.help
  return { command, positional, flags }
}
