# maxclicks CLI

The official [maxclicks](https://maxclicks.ai) command-line interface. Drive the maxclicks Public API v1 from your terminal, scripts, or an AI agent. Every command prints JSON to stdout and a structured error to stderr, so it composes cleanly with `jq` and with agents.

## Install

```bash
npm install -g maxclicks-cli
# or run without installing:
npx maxclicks-cli whoami
```

Requires Node.js 18+.

## Authenticate

```bash
maxclicks config set-key sk_live_...     # stored at ~/.config/maxclicks/config.json
# or:  export MAXCLICKS_API_KEY=sk_live_...
maxclicks whoami                          # confirm the key and its space
```

Create a key at `https://app.maxclicks.ai/-/settings/developers`. Use `--base-url https://api-stage.maxclicks.ai/v1` (or `MAXCLICKS_BASE_URL`) for staging, and `--profile <name>` to keep multiple spaces.

## Usage

```bash
maxclicks whoami
maxclicks schemas list [--type contact|object|event] [--all]
maxclicks schemas get <schema>
maxclicks attributes list <schema> [--all]
maxclicks records list <schema> [--all]
maxclicks records get <schema> <id>
maxclicks records create <schema> --data '{"email":"ada@example.com"}'
maxclicks records upsert <schema> --data '{"email":"ada@example.com","firstName":"Ada"}'
maxclicks records update <schema> <id> --data '{"tags":["beta"]}'
maxclicks records delete <schema> <id>
maxclicks records audit-trail <schema> <id> [--all]
maxclicks events fire <schema> --data '{"eventId":"ord_1","amount":42}'
maxclicks events fire-batch <schema> --data '[{...},{...}]' [--on-error abort]
maxclicks events list --schema <schema> [--from <iso>] [--to <iso>] [--all]
maxclicks templates list|get ...
maxclicks templates send <templateId> --data '{"contact":{"email":"ada@example.com"}}'
maxclicks webhooks list|get|create|update|delete|rotate-secret ...
maxclicks suppressions list|create|delete|batch-add|batch-remove ...
maxclicks segments list|get|count|contacts|create|delete ...
maxclicks broadcasts list|get|update|send|runs|metrics ...
maxclicks workflows list|get|runs|get-run|pause|unpause ...
maxclicks workflows trigger <reference> --data '{"anything":true}'
maxclicks domains list|get ...
maxclicks senders list [--all]
maxclicks topics list|get ...
maxclicks api GET /schemas          # raw escape hatch for anything not wrapped
maxclicks docs [query]
```

Run `maxclicks <command> --help` for details. List commands are paginated (`--limit`, `--offset`); pass `--all` to fetch every page as a flat array.

## The data model, in brief

maxclicks is schema-based: every record and event belongs to a schema (id or slug). Discover with `maxclicks schemas list` and `maxclicks attributes list <schema>` before writing. Schemas and attributes are read-only through the API. Records are flat: set base fields and custom attribute keys at the top level. Prefer `upsert` (idempotent by identity) over `create`.

## Also useful

- **AI agents**: install the maxclicks Agent Skills so your agent drives this CLI for you: `npx skills add https://maxclicks.ai` (see [maxclicks-ai](https://github.com/maxclicks-ai/maxclicks-ai)).
- **Application code**: use a maxclicks SDK (Node, Python, Go, PHP/Laravel, Ruby, Java, Rust) instead of shelling out.

## Development

```bash
npm run sdk:link   # pack the local maxclicks SDK (dev only)
npm install
npm run check      # type check
npm run build      # compile to dist/
```

## License

MIT
