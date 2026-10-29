# maxclicks CLI

The official [maxclicks](https://maxclicks.ai) command-line interface. Drive the maxclicks Public API v1 from your terminal, scripts, or an AI agent. API commands print JSON outcomes to stdout and request errors to stderr, so they compose with `jq` and with agents.

## Install

```bash
npm install -g maxclicks-cli
# or run without installing:
npx maxclicks-cli whoami
```

Requires Node.js 18+.

## Authenticate

```bash
maxclicks login        # opens your browser, then stores a new API key for this machine
maxclicks whoami       # confirm the key and its space
```

`maxclicks login --no-browser` prints the sign-in URL and waits, for SSH and headless hosts. To use an existing key instead, create one at `https://app.maxclicks.ai/space/-/settings/developers`, then:

```bash
maxclicks config set-key max_...     # stored at ~/.config/maxclicks/config.json, readable only by you
# or:  export MAXCLICKS_API_KEY=max_...
```

For staging, pass `--base-url https://api-stage.maxclicks.ai/v1` (or `MAXCLICKS_BASE_URL`), plus `--web-origin https://app-stage.maxclicks.ai` for `login`. Use `--profile <name>` to keep several spaces.

## Usage

```bash
maxclicks whoami
maxclicks schemas list [--type contact|object|event] [--all]
maxclicks schemas get <schema>
maxclicks attributes list <schema> [--all]
maxclicks records list <schema> [--all]
maxclicks records get <schema> <id>
maxclicks records create <schema> --data '{"email":"ada@example.com"}' [--idempotency-key <key>]
maxclicks records upsert <schema> --data '{"email":"ada@example.com","firstName":"Ada"}' [--idempotency-key <key>]
maxclicks records update <schema> <id> --data '{"tags":["beta"]}'
maxclicks records delete <schema> <id> [--idempotency-key <key>]
maxclicks records deletion-status <operationId>
maxclicks records cancel-deletion <operationId>
maxclicks records audit-trail <schema> <id> [--all]
maxclicks events fire <schema> --data '{"eventId":"ord_1","amount":42}'
maxclicks events fire-batch <schema> --data '[{...},{...}]' [--on-error abort]
maxclicks events status <schema> <id>
maxclicks events identify --data '{...}'
maxclicks events list --schema <schema> [--from <iso>] [--to <iso>] [--all]
maxclicks templates list|get ...
maxclicks templates send <templateId> --data '{"contact":{"email":"ada@example.com"}}' [--idempotency-key <key>]
maxclicks webhooks list|get|create|update|delete|rotate-secret ...
maxclicks suppressions list|create|delete|batch-add|batch-remove ...
maxclicks segments list|get|count|contacts|create|delete ...
maxclicks broadcasts list|get|update|send|runs|metrics ...
maxclicks workflows list|get|runs|get-run|pause|unpause ...
maxclicks workflows trigger <reference> --data '{"anything":true}' [--idempotency-key <key>]
maxclicks domains list|get ...
maxclicks senders list [--all]
maxclicks topics list|get ...
maxclicks api GET /schemas          # raw escape hatch for anything not wrapped
maxclicks docs [query]
```

Run `maxclicks <command> --help` for details. List commands are paginated (`--limit`, `--offset`); pass `--all` to fetch every page as a flat array.

`maxclicks templates send` prints the API's `emailId`, `status`, and `error` together with `templateId` and the `idempotencyKey` it used. A `failed` send keeps that JSON outcome on stdout and exits with status 1. To retry a send that timed out, pass the same `--idempotency-key`: the API replays the first outcome instead of sending twice. `records delete` works the same way and prints the deletion operation; follow it with `records deletion-status`. `maxclicks api` prints `{ status, body }` and exits with status 1 when the status is not 2xx.

## The data model, in brief

maxclicks is schema-based: every record and event belongs to a schema (id or slug). Discover with `maxclicks schemas list` and `maxclicks attributes list <schema>` before writing. Schemas and attributes are read-only through the API. Records are flat: set base fields and custom attribute keys at the top level. Prefer `upsert` (idempotent by identity) over `create`.

## Also useful

- **AI agents**: install the maxclicks Agent Skills so your agent drives this CLI for you: `npx skills add https://maxclicks.ai` (see [maxclicks-ai](https://github.com/maxclicks-ai/maxclicks-ai)).
- **Application code**: use a maxclicks SDK (Node, Python, Go, PHP/Laravel, Ruby, Java, Rust, Elixir) instead of shelling out.

## Development

```bash
npm --prefix ../maxclicks-node ci
npm run sdk:link   # build and install the sibling SDK tarball without changing manifests
npm run check      # type check
npm run build      # compile to dist/
node dist/cli.js --help
npm pack           # rebuild and pack the current source
```

`sdk:link` builds the sibling `../maxclicks-node` SDK and installs it without changing the manifest or lockfile, for testing CLI changes against unreleased SDK changes.

## License

MIT
