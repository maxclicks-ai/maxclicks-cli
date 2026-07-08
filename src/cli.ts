#!/usr/bin/env node
import { Command } from 'commander'
import { getClient } from './client.js'
import { getConfigPath, type GlobalOptions, maskKey, resolveConfig, writeApiKey } from './config.js'
import { action, parseData } from './output.js'
import { rawRequest } from './rawRequest.js'
import { VERSION } from './version.js'

const program = new Command()

program
  .name('maxclicks')
  .description(
    'The maxclicks command-line interface. Drive the maxclicks Public API from your terminal or an AI agent.'
  )
  .version(VERSION, '-v, --version')
  .option('--api-key <key>', 'API key (overrides MAXCLICKS_API_KEY and the config file)')
  .option('--base-url <url>', 'API base URL (defaults to https://api.maxclicks.ai/v1)')
  .option('--profile <name>', 'Config profile to use', 'default')

const globals = (): GlobalOptions => program.opts()
const client = () => getClient(globals())
const toInt = (value: string): number => parseInt(value, 10)

interface ListOptions {
  limit?: number
  offset?: number
  all?: boolean
}

async function renderPage<T>(
  pagePromise: Promise<{ data: T[]; pagination: unknown; warnings: unknown; all: () => Promise<T[]> }>,
  options: ListOptions
): Promise<unknown> {
  const page = await pagePromise
  if (options.all) return page.all()
  return { data: page.data, pagination: page.pagination, warnings: page.warnings }
}

function addListOptions(command: Command): Command {
  return command
    .option('--limit <n>', 'Page size (1-200)', toInt)
    .option('--offset <n>', 'Rows to skip', toInt)
    .option('--all', 'Fetch and return every page as a flat array')
}

// ---------------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------------

program
  .command('whoami')
  .description('Show the calling API key, its owner, and the bound space')
  .action(action(async () => client().me()))

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const config = program.command('config').description('Manage stored credentials')

config
  .command('set-key')
  .description('Store an API key for the current profile')
  .argument('<key>', 'The maxclicks API key')
  .action(
    action(async (key: string) => {
      const path = writeApiKey(globals().profile ?? 'default', key, globals().baseUrl)
      return { saved: path, profile: globals().profile ?? 'default' }
    })
  )

config
  .command('show')
  .description('Show the resolved config (the key is masked)')
  .action(
    action(async () => {
      const resolved = resolveConfig(globals())
      return { profile: resolved.profile, baseUrl: resolved.baseUrl, apiKey: maskKey(resolved.apiKey) }
    })
  )

config
  .command('path')
  .description('Print the config file path')
  .action(action(async () => ({ path: getConfigPath() })))

// ---------------------------------------------------------------------------
// Schemas and attributes
// ---------------------------------------------------------------------------

const schemas = program.command('schemas').description('Read the space schemas')

addListOptions(schemas.command('list').description('List schemas'))
  .option('--type <type...>', 'Filter by type: contact, object, or event')
  .action(
    action(async (options: ListOptions & { type?: string[] }) =>
      renderPage(
        client().schemas.list({ type: options.type as never, limit: options.limit, offset: options.offset }),
        options
      )
    )
  )

schemas
  .command('get')
  .description('Get a schema by id or slug')
  .argument('<schema>', 'Schema id or slug')
  .action(action(async (schema: string) => client().schemas.get(schema)))

const attributes = program.command('attributes').description('Read a schema attributes')

addListOptions(
  attributes.command('list').description('List a schema attributes').argument('<schema>', 'Schema id or slug')
).action(
  action(async (schema: string, options: ListOptions) => renderPage(client().attributes.list(schema, options), options))
)

attributes
  .command('get')
  .description('Get one attribute (base:<key>, an attribute id, or a raw key)')
  .argument('<schema>', 'Schema id or slug')
  .argument('<attribute>', 'base:<key>, attribute id, or key')
  .action(action(async (schema: string, attribute: string) => client().attributes.get(schema, attribute)))

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

const records = program.command('records').description('Create, read, update, and delete contact and object records')

addListOptions(
  records.command('list').description('List records in a schema').argument('<schema>', 'Schema id or slug')
).action(
  action(async (schema: string, options: ListOptions) => renderPage(client().records.list(schema, options), options))
)

records
  .command('get')
  .description('Get a record by id')
  .argument('<schema>', 'Schema id or slug')
  .argument('<id>', 'Record id')
  .action(action(async (schema: string, id: string) => client().records.get(schema, id)))

records
  .command('create')
  .description('Strictly create a record (fails if an identifier already exists)')
  .argument('<schema>', 'Schema id or slug')
  .requiredOption('--data <json>', 'Flat record fields as JSON')
  .action(
    action(async (schema: string, options: { data: string }) =>
      client().records.create(schema, parseData(options.data) as never)
    )
  )

records
  .command('upsert')
  .description('Create or update a record by identity')
  .argument('<schema>', 'Schema id or slug')
  .requiredOption('--data <json>', 'Flat record fields as JSON')
  .action(
    action(async (schema: string, options: { data: string }) =>
      client().records.upsert(schema, parseData(options.data) as never)
    )
  )

records
  .command('update')
  .description('Partially update a record by id')
  .argument('<schema>', 'Schema id or slug')
  .argument('<id>', 'Record id')
  .requiredOption('--data <json>', 'Fields to change as JSON (null clears a nullable field)')
  .action(
    action(async (schema: string, id: string, options: { data: string }) =>
      client().records.update(schema, id, parseData(options.data) as never)
    )
  )

records
  .command('delete')
  .description('Delete a record by id')
  .argument('<schema>', 'Schema id or slug')
  .argument('<id>', 'Record id')
  .action(action(async (schema: string, id: string) => client().records.delete(schema, id)))

addListOptions(
  records
    .command('audit-trail')
    .description('List a contact consent audit trail')
    .argument('<schema>', 'Contact schema id or slug')
    .argument('<id>', 'Contact id')
)
  .option('--channel <channel>', 'Filter by channel (email)')
  .action(
    action(async (schema: string, id: string, options: ListOptions & { channel?: string }) =>
      renderPage(
        client().records.auditTrail(schema, id, {
          channel: options.channel as never,
          limit: options.limit,
          offset: options.offset,
        }),
        options
      )
    )
  )

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

const events = program.command('events').description('Fire and read trigger events')

events
  .command('fire')
  .description('Fire a single event of an event schema')
  .argument('<schema>', 'Event schema id or slug')
  .requiredOption('--data <json>', 'Flat event payload as JSON')
  .action(
    action(async (schema: string, options: { data: string }) =>
      client().events.fire(schema, parseData(options.data) as never)
    )
  )

events
  .command('fire-batch')
  .description('Fire up to 500 events of one schema')
  .argument('<schema>', 'Event schema id or slug')
  .requiredOption('--data <json>', 'JSON array of event payloads')
  .option('--on-error <mode>', 'continue (default) or abort')
  .action(
    action(async (schema: string, options: { data: string; onError?: 'continue' | 'abort' }) =>
      client().events.fireBatch(schema, parseData(options.data) as never, { onError: options.onError })
    )
  )

events
  .command('get')
  .description('Get a fired event by id')
  .argument('<id>', 'Event id')
  .action(action(async (id: string) => client().events.get(id)))

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

program
  .command('templates')
  .description('Send stored templates')
  .command('send')
  .description('Send a template with a data payload')
  .argument('<templateId>', 'Template id')
  .requiredOption('--data <json>', 'Template data payload as JSON')
  .action(
    action(async (templateId: string, options: { data: string }) => {
      await client().templates.send(templateId, { data: parseData(options.data) as Record<string, unknown> })
      return { sent: true, templateId }
    })
  )

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

const webhooks = program.command('webhooks').description('Manage outgoing webhooks')

addListOptions(webhooks.command('list').description('List webhooks')).action(
  action(async (options: ListOptions) => renderPage(client().webhooks.list(options), options))
)

webhooks
  .command('get')
  .description('Get a webhook by id')
  .argument('<id>', 'Webhook id')
  .action(action(async (id: string) => client().webhooks.get(id)))

webhooks
  .command('create')
  .description('Create a webhook (the response includes the signing secret once)')
  .requiredOption('--data <json>', 'Webhook params as JSON (url, trigger, schemaId, ...)')
  .action(action(async (options: { data: string }) => client().webhooks.create(parseData(options.data) as never)))

webhooks
  .command('update')
  .description('Update a webhook')
  .argument('<id>', 'Webhook id')
  .requiredOption('--data <json>', 'Fields to change as JSON')
  .action(
    action(async (id: string, options: { data: string }) =>
      client().webhooks.update(id, parseData(options.data) as never)
    )
  )

webhooks
  .command('delete')
  .description('Delete a webhook')
  .argument('<id>', 'Webhook id')
  .action(action(async (id: string) => client().webhooks.delete(id)))

webhooks
  .command('rotate-secret')
  .description('Rotate a webhook signing secret')
  .argument('<id>', 'Webhook id')
  .action(action(async (id: string) => client().webhooks.rotateSecret(id)))

// ---------------------------------------------------------------------------
// Suppressions
// ---------------------------------------------------------------------------

const suppressions = program.command('suppressions').description('Manage the email do-not-contact list (admin key)')

suppressions
  .command('create')
  .description('Suppress an email identifier')
  .option('--data <json>', 'Full input as JSON')
  .option('--identifier <email>', 'Email to suppress')
  .option('--reason <reason>', 'manual or legal')
  .option('--notes <notes>', 'Optional notes')
  .action(
    action(async (options: { data?: string; identifier?: string; reason?: string; notes?: string }) => {
      const input = options.data
        ? (parseData(options.data) as never)
        : ({ identifier: options.identifier, reason: options.reason, notes: options.notes } as never)
      return client().suppressions.create(input)
    })
  )

suppressions
  .command('delete')
  .description('Remove a suppression by id')
  .argument('<id>', 'Suppression id')
  .action(action(async (id: string) => client().suppressions.delete(id)))

// ---------------------------------------------------------------------------
// Workflows
// ---------------------------------------------------------------------------

program
  .command('workflows')
  .description('Trigger workflows')
  .command('trigger')
  .description('Trigger a workflow through its incoming-webhook step')
  .argument('<reference>', 'Incoming-webhook step reference id')
  .option('--data <json>', 'Run input payload as JSON')
  .action(
    action(async (reference: string, options: { data?: string }) => {
      await client().workflows.trigger(reference, options.data ? parseData(options.data) : {})
      return { triggered: true, reference }
    })
  )

// ---------------------------------------------------------------------------
// Raw API + docs
// ---------------------------------------------------------------------------

program
  .command('api')
  .description('Make a raw authenticated request to any API path')
  .argument('<method>', 'HTTP method (GET, POST, PATCH, DELETE)')
  .argument('<path>', 'Path under the base URL, e.g. /schemas or /me')
  .option('--data <json>', 'Raw JSON request body')
  .action(
    action(async (method: string, path: string, options: { data?: string }) =>
      rawRequest(globals(), method, path, options.data)
    )
  )

program
  .command('docs')
  .description('Print links to the maxclicks documentation and machine-readable references')
  .argument('[query]', 'Optional topic to search for')
  .action(
    action(async (query?: string) => ({
      documentation: 'https://docs.maxclicks.ai',
      apiReference: 'https://docs.maxclicks.ai/api',
      openapi: 'https://maxclicks.ai/openapi.json',
      llmsText: 'https://maxclicks.ai/llms.txt',
      ...(query
        ? { note: `Search the documentation for "${query}", or fetch llms-full.txt for the full corpus.` }
        : {}),
    }))
  )

program.parseAsync(process.argv).catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
