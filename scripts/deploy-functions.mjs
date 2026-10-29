#!/usr/bin/env node
/**
 * deploy-functions
 *
 * Deploys Supabase edge functions with the per-function JWT setting that
 * `supabase functions deploy` cannot express on its own.
 *
 * Why this exists
 * ───────────────
 * `--no-verify-jwt` is a per-deploy flag, not stored state, and a deploy-all
 * (`supabase functions deploy` with no function name) applies one flag to
 * every function — so it can only ever be all-or-nothing. On 2026-08-27 a
 * deploy-all silently re-armed JWT verification on resendWebhook. Resend
 * sends only Svix headers, so the Supabase gateway then rejected every
 * delivery with 401 UNAUTHORIZED_NO_AUTH_HEADER before the function booted.
 * Resend retried, kept failing, and disabled the endpoint. Nothing in the
 * app surfaced it: delivery statuses just silently stopped advancing past
 * 'sent' for six days.
 *
 * This script splits the deploy into two batches — functions declared
 * `verify_jwt = false` and everything else — so each gets the right flag,
 * then reads the deployed state back and fails loudly on any mismatch.
 *
 * supabase/config.toml is the single source of truth. Adding a function
 * there is all it takes; there is no second list to keep in sync.
 * (config.toml alone does NOT work: CLI 2.107.0 ignores verify_jwt on
 * `functions deploy` — verified 2026-09-02. Hence this script.)
 *
 * Usage
 * ─────
 *   npm run deploy:functions              # every function under supabase/functions
 *   npm run deploy:functions -- sendEmail resendWebhook
 *   npm run deploy:check                  # audit only, deploys nothing
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ROOT          = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_PATH   = join(ROOT, 'supabase', 'config.toml');
const FUNCTIONS_DIR = join(ROOT, 'supabase', 'functions');

const VALID_NAME = /^[A-Za-z0-9_-]+$/;

/**
 * Extracts the functions declared `verify_jwt = false` in config.toml.
 *
 * A deliberately small parser rather than a TOML dependency: it only has to
 * understand `[functions.<name>]` headers and a boolean under them. Comments
 * are stripped naively on `#`, which is safe here because no value we read is
 * a string.
 */
function readNoVerifyJwt() {
  if (!existsSync(CONFIG_PATH)) {
    fail(`supabase/config.toml not found — it declares which functions skip JWT verification.`);
  }

  const needsFlag = new Set();
  let section = null;

  for (const rawLine of readFileSync(CONFIG_PATH, 'utf8').split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;

    const header = line.match(/^\[functions\.([A-Za-z0-9_-]+)\]$/);
    if (header) { section = header[1]; continue; }
    if (line.startsWith('[')) { section = null; continue; }   // some other table

    if (section && /^verify_jwt\s*=\s*false$/.test(line)) needsFlag.add(section);
  }
  return needsFlag;
}

/** Function directories that actually exist locally. `_shared` is a library, not a function. */
function localFunctions() {
  return readdirSync(FUNCTIONS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('_'))
    .map((e) => e.name)
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
}

/**
 * Runs the Supabase CLI.
 *
 * The command goes through a shell as a single string, not an argv array:
 * on Windows `supabase` is a .cmd shim that only resolves via a shell, and
 * pairing shell:true with an args array is deprecated (DEP0190) because Node
 * concatenates the arguments without escaping them. Everything passed here is
 * either a literal flag or a function name already checked against
 * VALID_NAME, so joining is safe — keep that check if you add arguments.
 */
function supabase(args, { capture = false } = {}) {
  return spawnSync(['supabase', ...args].join(' '), {
    cwd: ROOT,
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    shell: true,
    encoding: 'utf8',
  });
}

/** Deployed state, keyed by function name. */
function deployedState() {
  const res = supabase(['functions', 'list', '--output', 'json'], { capture: true });
  if (res.status !== 0) {
    fail(`supabase functions list failed:\n${(res.stderr || res.stdout || '').trim()}`);
  }
  try {
    return new Map(JSON.parse(res.stdout).map((f) => [f.name, f]));
  } catch {
    fail(`Could not parse the output of supabase functions list.`);
  }
}

function fail(message) {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

// ── main ───────────────────────────────────────────────────────────────
const argv      = process.argv.slice(2);
const checkOnly = argv.includes('--check');
const named     = argv.filter((a) => !a.startsWith('--'));

for (const name of named) {
  if (!VALID_NAME.test(name)) fail(`Refusing to pass an unexpected function name: ${name}`);
}

const needsFlag = readNoVerifyJwt();
const available = localFunctions();
const targets   = named.length ? named : available;

for (const name of targets) {
  if (!available.includes(name)) fail(`No such function locally: supabase/functions/${name}`);
}

const open   = targets.filter((n) => needsFlag.has(n));   // deploy --no-verify-jwt
const closed = targets.filter((n) => !needsFlag.has(n));  // deploy with JWT verification

if (!checkOnly) {
  console.log(`Deploying ${targets.length} function(s).`);
  if (open.length) console.log(`  no JWT verification (per config.toml): ${open.join(', ')}`);
  console.log('');

  // Two batches, because one CLI invocation can only carry one flag value.
  for (const [names, extraFlags] of [[closed, []], [open, ['--no-verify-jwt']]]) {
    if (!names.length) continue;
    const res = supabase(['functions', 'deploy', ...names, ...extraFlags]);
    if (res.status !== 0) fail(`Deploy failed for: ${names.join(', ')}`);
  }
}

// ── audit ──────────────────────────────────────────────────────────────
// The point of the script. A deploy that "succeeded" but left the gateway
// closed on resendWebhook is the exact failure this is here to catch.
console.log(`\nVerifying deployed JWT settings against supabase/config.toml…\n`);

const deployed  = deployedState();
const mismatches = [];

for (const name of targets) {
  const expected = !needsFlag.has(name);          // true = gateway requires a JWT
  const fn       = deployed.get(name);

  if (!fn) {
    mismatches.push(`${name}: declared locally but not deployed`);
    continue;
  }
  const actual = fn.verify_jwt;
  const ok     = actual === expected;
  if (!ok) {
    mismatches.push(
      `${name}: verify_jwt is ${actual}, config.toml expects ${expected}`,
    );
  }
  console.log(`  ${ok ? '✓' : '✗'} ${name.padEnd(28)} verify_jwt=${String(actual).padEnd(5)} v${fn.version}`);
}

if (mismatches.length) {
  console.error(`\n✗ ${mismatches.length} function(s) do not match config.toml:\n`);
  for (const m of mismatches) console.error(`    ${m}`);
  console.error(
    `\n  For resendWebhook this means Resend's deliveries are being rejected by the\n` +
    `  gateway with 401 UNAUTHORIZED_NO_AUTH_HEADER, and Resend will disable the\n` +
    `  endpoint again. Re-run this script; do not deploy that function by hand.\n`,
  );
  process.exit(1);
}

console.log(`\n✓ All ${targets.length} function(s) match config.toml.\n`);
