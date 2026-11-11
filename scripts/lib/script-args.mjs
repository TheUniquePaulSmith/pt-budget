// Arguments a package.json script was given, the same under npm and pnpm.
//
// `npm run x -- --flag` swallows the `--`; `pnpm run x -- --flag` passes it on,
// so the script sees ['--', '--flag']. pnpm needs no separator at all
// (`pnpm run x --flag`). Dropping one leading `--` keeps every spelling working.
export function scriptArgs(argv = process.argv.slice(2)) {
  return argv[0] === '--' ? argv.slice(1) : argv;
}
