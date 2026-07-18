#!/usr/bin/env node
import { Command } from 'commander'
import { apiList, apiListCursor, apiRequest, apiRequestText } from './apiRequest.js'
import { getClient } from './client.js'
import { getConfigPath, type GlobalOptions, maskKey, resolveConfig, writeApiKey } from './config.js'
import { login, type LoginOptions } from './login.js'
import { logout, type LogoutOptions } from './logout.js'
import { action, fail, parseData } from './output.js'
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
  .option('--web-origin <url>', 'Web app origin for login (defaults to https://app.maxclicks.ai)')
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
// Login / logout
// ---------------------------------------------------------------------------

program
  .command('login')
  .description('Sign in via your browser and mint an API key for this machine (Stripe/Shopify-CLI-style)')
  .option('--no-browser', "Don't open a browser; print the URL and poll instead (for SSH/headless use)")
  .action(action(async (options: LoginOptions) => login(globals(), options)))

program
  .command('logout')
  .description('Clear the locally stored API key for this profile')
  .option('--revoke', 'Also delete the API key server-side (requires admin access to its space)')
  .action(action(async (options: LogoutOptions) => logout(globals(), options)))

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

schemas
  .command('create')
  .description('Create a contact, object, or event schema')
  .requiredOption('--data <json>', 'Schema params as JSON ({type,name,namePlural,slug,description?})')
  .option('--idempotency-key <key>', 'Make retries of this create safe')
  .action(
    action(async (options: { data: string; idempotencyKey?: string }) =>
      apiRequest(globals(), {
        method: 'POST',
        path: '/schemas',
        body: parseData(options.data),
        idempotencyKey: options.idempotencyKey,
      })
    )
  )

schemas
  .command('update')
  .description('Update a schema (name, namePlural, description; type and slug are immutable)')
  .argument('<schema>', 'Schema id or slug')
  .requiredOption('--data <json>', 'Fields to change as JSON ({name?,namePlural?,description?})')
  .action(
    action(async (schema: string, options: { data: string }) =>
      apiRequest(globals(), {
        method: 'PATCH',
        path: `/schemas/${encodeURIComponent(schema)}`,
        body: parseData(options.data),
      })
    )
  )

schemas
  .command('delete')
  .description('Delete a schema and cascade its records')
  .argument('<schema>', 'Schema id or slug')
  .action(
    action(async (schema: string) =>
      apiRequest(globals(), { method: 'DELETE', path: `/schemas/${encodeURIComponent(schema)}` })
    )
  )

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

attributes
  .command('create')
  .description('Add a stored attribute (--data) or an AI-generated evaluated attribute (--requirements)')
  .argument('<schema>', 'Schema id or slug')
  .option('--data <json>', 'Stored attribute as JSON ({key,label,description?,definition})')
  .option('--requirements <text>', 'Natural-language prompt to generate an evaluated attribute (slow, billed)')
  .option('--key <key>', 'Attribute key (with --requirements)')
  .option('--label <label>', 'Attribute label (with --requirements)')
  .option('--description <text>', 'Attribute description (with --requirements)')
  .action(
    action(
      async (
        schema: string,
        options: { data?: string; requirements?: string; key?: string; label?: string; description?: string }
      ) => {
        const body =
          options.requirements !== undefined
            ? {
                key: options.key,
                label: options.label,
                description: options.description ?? null,
                requirements: options.requirements,
              }
            : parseData(options.data)
        if (body === undefined) fail(new Error('Provide either --data (stored) or --requirements (evaluated).'))
        return apiRequest(globals(), {
          method: 'POST',
          path: `/schemas/${encodeURIComponent(schema)}/attributes`,
          body,
        })
      }
    )
  )

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
  .option('--idempotency-key <key>', 'Make retries of this create safe (replays the original record)')
  .action(
    action(async (schema: string, options: { data: string; idempotencyKey?: string }) => {
      const body = parseData(options.data)
      if (options.idempotencyKey)
        return apiRequest(globals(), {
          method: 'POST',
          path: `/schemas/${encodeURIComponent(schema)}/records`,
          body,
          idempotencyKey: options.idempotencyKey,
        })
      return client().records.create(schema, body as never)
    })
  )

records
  .command('upsert')
  .description('Create or update a record by identity')
  .argument('<schema>', 'Schema id or slug')
  .requiredOption('--data <json>', 'Flat record fields as JSON')
  .option('--idempotency-key <key>', 'Make retries of this upsert safe (replays the original record)')
  .action(
    action(async (schema: string, options: { data: string; idempotencyKey?: string }) => {
      const body = parseData(options.data)
      if (options.idempotencyKey)
        return apiRequest(globals(), {
          method: 'POST',
          path: `/schemas/${encodeURIComponent(schema)}/records/upsert`,
          body,
          idempotencyKey: options.idempotencyKey,
        })
      return client().records.upsert(schema, body as never)
    })
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

events
  .command('list')
  .description('List an event schema history (cursor-paginated, newest first)')
  .requiredOption('--schema <schema>', 'Event schema id or slug')
  .option('--from <iso>', 'Start of the time range (ISO 8601)')
  .option('--to <iso>', 'End of the time range (ISO 8601)')
  .option('--cursor <cursor>', 'Opaque cursor from a previous page')
  .option('--limit <n>', 'Page size (1-200)', toInt)
  .option('--all', 'Fetch and return every page as a flat array')
  .action(
    action(
      async (options: { schema: string; from?: string; to?: string; cursor?: string; limit?: number; all?: boolean }) =>
        apiListCursor(globals(), '/events', {
          limit: options.limit,
          cursor: options.cursor,
          all: options.all,
          query: { schema: options.schema, from: options.from, to: options.to },
        })
    )
  )

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

const templates = program.command('templates').description('Manage and send stored message templates')

addListOptions(templates.command('list').description('List templates')).action(
  action(async (options: ListOptions) => apiList(globals(), '/templates', options))
)

templates
  .command('get')
  .description('Get a template by id')
  .argument('<id>', 'Template id')
  .action(
    action(async (id: string) => apiRequest(globals(), { method: 'GET', path: `/templates/${encodeURIComponent(id)}` }))
  )

templates
  .command('create')
  .description('Create a template with raw editor content')
  .requiredOption('--data <json>', 'Template params as JSON')
  .option('--idempotency-key <key>', 'Make retries of this create safe')
  .action(
    action(async (options: { data: string; idempotencyKey?: string }) =>
      apiRequest(globals(), {
        method: 'POST',
        path: '/templates',
        body: parseData(options.data),
        idempotencyKey: options.idempotencyKey,
      })
    )
  )

templates
  .command('update')
  .description('Update a template')
  .argument('<id>', 'Template id')
  .requiredOption('--data <json>', 'Fields to change as JSON')
  .action(
    action(async (id: string, options: { data: string }) =>
      apiRequest(globals(), {
        method: 'PATCH',
        path: `/templates/${encodeURIComponent(id)}`,
        body: parseData(options.data),
      })
    )
  )

templates
  .command('delete')
  .description('Delete a template')
  .argument('<id>', 'Template id')
  .action(
    action(async (id: string) =>
      apiRequest(globals(), { method: 'DELETE', path: `/templates/${encodeURIComponent(id)}` })
    )
  )

templates
  .command('duplicate')
  .description('Duplicate a template')
  .argument('<id>', 'Template id')
  .option('--idempotency-key <key>', 'Make retries of this duplicate safe')
  .action(
    action(async (id: string, options: { idempotencyKey?: string }) =>
      apiRequest(globals(), {
        method: 'POST',
        path: `/templates/${encodeURIComponent(id)}/duplicate`,
        idempotencyKey: options.idempotencyKey,
      })
    )
  )

templates
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

addListOptions(suppressions.command('list').description('List suppressions (admin key)'))
  .option('--identifier <email>', 'Filter to the suppression(s) for one email address')
  .action(
    action(async (options: ListOptions & { identifier?: string }) =>
      apiList(globals(), '/contacts/suppressions', {
        limit: options.limit,
        offset: options.offset,
        all: options.all,
        query: { identifier: options.identifier },
      })
    )
  )

suppressions
  .command('get')
  .description('Get a suppression by id (admin key)')
  .argument('<id>', 'Suppression id')
  .action(
    action(async (id: string) =>
      apiRequest(globals(), { method: 'GET', path: `/contacts/suppressions/${encodeURIComponent(id)}` })
    )
  )

suppressions
  .command('batch-add')
  .description('Bulk-suppress 1-100 email identifiers (admin key)')
  .requiredOption('--data <json>', 'JSON body ({suppressions:[{identifier,reason,notes?}]})')
  .option('--idempotency-key <key>', 'Make retries of this batch safe')
  .action(
    action(async (options: { data: string; idempotencyKey?: string }) =>
      apiRequest(globals(), {
        method: 'POST',
        path: '/contacts/suppressions/batch',
        body: parseData(options.data),
        idempotencyKey: options.idempotencyKey,
      })
    )
  )

suppressions
  .command('batch-remove')
  .description('Bulk-remove 1-100 suppressions by id (admin key)')
  .requiredOption('--data <json>', 'JSON body ({ids:[...]})')
  .option('--idempotency-key <key>', 'Make retries of this batch safe')
  .action(
    action(async (options: { data: string; idempotencyKey?: string }) =>
      apiRequest(globals(), {
        method: 'POST',
        path: '/contacts/suppressions/batch-remove',
        body: parseData(options.data),
        idempotencyKey: options.idempotencyKey,
      })
    )
  )

// ---------------------------------------------------------------------------
// Workflows
// ---------------------------------------------------------------------------

const workflows = program.command('workflows').description('Trigger workflows and inspect their runs')

addListOptions(workflows.command('list').description('List workflows')).action(
  action(async (options: ListOptions) => apiList(globals(), '/workflows', options))
)

workflows
  .command('get')
  .description('Get a workflow by id')
  .argument('<id>', 'Workflow id')
  .action(
    action(async (id: string) => apiRequest(globals(), { method: 'GET', path: `/workflows/${encodeURIComponent(id)}` }))
  )

addListOptions(workflows.command('runs').description("List a workflow's runs").argument('<id>', 'Workflow id')).action(
  action(async (id: string, options: ListOptions) =>
    apiList(globals(), `/workflows/${encodeURIComponent(id)}/runs`, options)
  )
)

workflows
  .command('get-run')
  .description('Get a single workflow run')
  .argument('<id>', 'Workflow id')
  .argument('<runId>', 'Workflow run id')
  .action(
    action(async (id: string, runId: string) =>
      apiRequest(globals(), {
        method: 'GET',
        path: `/workflows/${encodeURIComponent(id)}/runs/${encodeURIComponent(runId)}`,
      })
    )
  )

workflows
  .command('pause')
  .description('Pause a workflow (stops new runs from starting)')
  .argument('<id>', 'Workflow id')
  .action(
    action(async (id: string) =>
      apiRequest(globals(), { method: 'POST', path: `/workflows/${encodeURIComponent(id)}/pause` })
    )
  )

workflows
  .command('unpause')
  .description('Unpause a workflow')
  .argument('<id>', 'Workflow id')
  .action(
    action(async (id: string) =>
      apiRequest(globals(), { method: 'POST', path: `/workflows/${encodeURIComponent(id)}/unpause` })
    )
  )

workflows
  .command('delete')
  .description('Delete a workflow')
  .argument('<id>', 'Workflow id')
  .action(
    action(async (id: string) =>
      apiRequest(globals(), { method: 'DELETE', path: `/workflows/${encodeURIComponent(id)}` })
    )
  )

workflows
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
// Segments
// ---------------------------------------------------------------------------

const segments = program.command('segments').description('Generate and manage AI-defined contact filters')

addListOptions(segments.command('list').description('List segments')).action(
  action(async (options: ListOptions) => apiList(globals(), '/segments', options))
)

segments
  .command('get')
  .description('Get a segment by id')
  .argument('<id>', 'Segment id')
  .action(
    action(async (id: string) => apiRequest(globals(), { method: 'GET', path: `/segments/${encodeURIComponent(id)}` }))
  )

segments
  .command('count')
  .description("Count a segment's matching contacts")
  .argument('<id>', 'Segment id')
  .action(
    action(async (id: string) =>
      apiRequest(globals(), { method: 'GET', path: `/segments/${encodeURIComponent(id)}/count` })
    )
  )

addListOptions(
  segments.command('contacts').description("List a segment's matching contacts").argument('<id>', 'Segment id')
).action(
  action(async (id: string, options: ListOptions) =>
    apiList(globals(), `/segments/${encodeURIComponent(id)}/contacts`, options)
  )
)

segments
  .command('create')
  .description('Generate a segment from a natural-language requirements prompt (slow ~10-90s, billed)')
  .requiredOption('--name <name>', 'Segment name')
  .requiredOption('--contact-schema <schema>', 'Contact schema id or slug')
  .requiredOption('--requirements <text>', 'Natural-language filter criteria')
  .option('--description <text>', 'Optional description')
  .action(
    action(async (options: { name: string; contactSchema: string; requirements: string; description?: string }) =>
      apiRequest(globals(), {
        method: 'POST',
        path: '/segments',
        body: {
          name: options.name,
          contactSchema: options.contactSchema,
          requirements: options.requirements,
          description: options.description ?? null,
        },
      })
    )
  )

segments
  .command('update')
  .description('Update a segment (name/description via --data, or --requirements to regenerate the condition)')
  .argument('<id>', 'Segment id')
  .option('--data <json>', 'Fields to change as JSON ({name?,description?})')
  .option('--requirements <text>', 'Regenerate the condition from a new prompt (slow, billed)')
  .action(
    action(async (id: string, options: { data?: string; requirements?: string }) => {
      const body = {
        ...(options.data ? (parseData(options.data) as Record<string, unknown>) : {}),
        ...(options.requirements !== undefined ? { requirements: options.requirements } : {}),
      }
      if (Object.keys(body).length === 0) fail(new Error('Provide --data and/or --requirements.'))
      return apiRequest(globals(), { method: 'PATCH', path: `/segments/${encodeURIComponent(id)}`, body })
    })
  )

segments
  .command('delete')
  .description('Delete a segment')
  .argument('<id>', 'Segment id')
  .action(
    action(async (id: string) =>
      apiRequest(globals(), { method: 'DELETE', path: `/segments/${encodeURIComponent(id)}` })
    )
  )

// ---------------------------------------------------------------------------
// Broadcasts
// ---------------------------------------------------------------------------

const broadcasts = program.command('broadcasts').description('Create, schedule, and send mass emails')

addListOptions(broadcasts.command('list').description('List broadcasts')).action(
  action(async (options: ListOptions) => apiList(globals(), '/broadcasts', options))
)

broadcasts
  .command('get')
  .description('Get a broadcast by id')
  .argument('<id>', 'Broadcast id')
  .action(
    action(async (id: string) =>
      apiRequest(globals(), { method: 'GET', path: `/broadcasts/${encodeURIComponent(id)}` })
    )
  )

broadcasts
  .command('create')
  .description('Create a broadcast')
  .requiredOption('--data <json>', 'Broadcast params as JSON ({contactSchema, audience?, content?, ...})')
  .option('--idempotency-key <key>', 'Make retries of this create safe')
  .action(
    action(async (options: { data: string; idempotencyKey?: string }) =>
      apiRequest(globals(), {
        method: 'POST',
        path: '/broadcasts',
        body: parseData(options.data),
        idempotencyKey: options.idempotencyKey,
      })
    )
  )

broadcasts
  .command('update')
  .description('Update a broadcast (name/description/audience/scheduledFor)')
  .argument('<id>', 'Broadcast id')
  .requiredOption('--data <json>', 'Fields to change as JSON')
  .action(
    action(async (id: string, options: { data: string }) =>
      apiRequest(globals(), {
        method: 'PATCH',
        path: `/broadcasts/${encodeURIComponent(id)}`,
        body: parseData(options.data),
      })
    )
  )

broadcasts
  .command('delete')
  .description('Delete a broadcast')
  .argument('<id>', 'Broadcast id')
  .action(
    action(async (id: string) =>
      apiRequest(globals(), { method: 'DELETE', path: `/broadcasts/${encodeURIComponent(id)}` })
    )
  )

broadcasts
  .command('send')
  .description('Send a broadcast now, or at --data {scheduledFor}')
  .argument('<id>', 'Broadcast id')
  .option('--data <json>', 'Optional JSON body ({scheduledFor})')
  .action(
    action(async (id: string, options: { data?: string }) =>
      apiRequest(globals(), {
        method: 'POST',
        path: `/broadcasts/${encodeURIComponent(id)}/send`,
        body: options.data ? parseData(options.data) : undefined,
      })
    )
  )

broadcasts
  .command('audience-generate')
  .description('Generate a custom-filter audience from a natural-language prompt (slow, billed)')
  .argument('<id>', 'Broadcast id')
  .requiredOption('--requirements <text>', 'Natural-language audience criteria')
  .action(
    action(async (id: string, options: { requirements: string }) =>
      apiRequest(globals(), {
        method: 'POST',
        path: `/broadcasts/${encodeURIComponent(id)}/audience/generate`,
        body: { requirements: options.requirements },
      })
    )
  )

addListOptions(
  broadcasts.command('runs').description("List a broadcast's runs").argument('<id>', 'Broadcast id')
).action(
  action(async (id: string, options: ListOptions) =>
    apiList(globals(), `/broadcasts/${encodeURIComponent(id)}/runs`, options)
  )
)

broadcasts
  .command('metrics')
  .description("Get a broadcast's aggregated email metrics")
  .argument('<id>', 'Broadcast id')
  .action(
    action(async (id: string) =>
      apiRequest(globals(), { method: 'GET', path: `/broadcasts/${encodeURIComponent(id)}/metrics` })
    )
  )

// ---------------------------------------------------------------------------
// Domains
// ---------------------------------------------------------------------------

const domains = program.command('domains').description('Manage sending domains (admin key)')

addListOptions(domains.command('list').description('List domains')).action(
  action(async (options: ListOptions) => apiList(globals(), '/domains', options))
)

domains
  .command('get')
  .description('Get a domain by id (includes live-checked DNS records)')
  .argument('<id>', 'Domain id')
  .action(
    action(async (id: string) => apiRequest(globals(), { method: 'GET', path: `/domains/${encodeURIComponent(id)}` }))
  )

domains
  .command('create')
  .description('Add a sending domain and provision its DNS records')
  .requiredOption('--data <json>', 'JSON body ({name, customReturnPath?})')
  .option('--idempotency-key <key>', 'Make retries of this create safe')
  .action(
    action(async (options: { data: string; idempotencyKey?: string }) =>
      apiRequest(globals(), {
        method: 'POST',
        path: '/domains',
        body: parseData(options.data),
        idempotencyKey: options.idempotencyKey,
      })
    )
  )

domains
  .command('verify')
  .description('Live-check DNS and refresh a domain verification state')
  .argument('<id>', 'Domain id')
  .action(
    action(async (id: string) =>
      apiRequest(globals(), { method: 'POST', path: `/domains/${encodeURIComponent(id)}/verify` })
    )
  )

domains
  .command('delete')
  .description('Delete a domain')
  .argument('<id>', 'Domain id')
  .action(
    action(async (id: string) =>
      apiRequest(globals(), { method: 'DELETE', path: `/domains/${encodeURIComponent(id)}` })
    )
  )

// ---------------------------------------------------------------------------
// Senders
// ---------------------------------------------------------------------------

const senders = program.command('senders').description('Manage saved sender profiles')

addListOptions(senders.command('list').description('List senders')).action(
  action(async (options: ListOptions) => apiList(globals(), '/senders', options))
)

senders
  .command('get')
  .description('Get a sender by id')
  .argument('<id>', 'Sender id')
  .action(
    action(async (id: string) => apiRequest(globals(), { method: 'GET', path: `/senders/${encodeURIComponent(id)}` }))
  )

senders
  .command('create')
  .description('Create a saved sender profile')
  .requiredOption('--data <json>', 'JSON body ({name, code, domainId, description?})')
  .option('--idempotency-key <key>', 'Make retries of this create safe')
  .action(
    action(async (options: { data: string; idempotencyKey?: string }) =>
      apiRequest(globals(), {
        method: 'POST',
        path: '/senders',
        body: parseData(options.data),
        idempotencyKey: options.idempotencyKey,
      })
    )
  )

senders
  .command('update')
  .description('Update a sender')
  .argument('<id>', 'Sender id')
  .requiredOption('--data <json>', 'Fields to change as JSON')
  .action(
    action(async (id: string, options: { data: string }) =>
      apiRequest(globals(), {
        method: 'PATCH',
        path: `/senders/${encodeURIComponent(id)}`,
        body: parseData(options.data),
      })
    )
  )

senders
  .command('delete')
  .description('Delete a sender')
  .argument('<id>', 'Sender id')
  .action(
    action(async (id: string) =>
      apiRequest(globals(), { method: 'DELETE', path: `/senders/${encodeURIComponent(id)}` })
    )
  )

// ---------------------------------------------------------------------------
// Topics
// ---------------------------------------------------------------------------

const topics = program.command('topics').description('Manage communication topics')

addListOptions(topics.command('list').description('List topics')).action(
  action(async (options: ListOptions) => apiList(globals(), '/topics', options))
)

topics
  .command('get')
  .description('Get a topic by id')
  .argument('<id>', 'Topic id')
  .action(
    action(async (id: string) => apiRequest(globals(), { method: 'GET', path: `/topics/${encodeURIComponent(id)}` }))
  )

topics
  .command('create')
  .description('Create a communication topic')
  .requiredOption('--data <json>', 'JSON body ({name, description?, color?, private?})')
  .option('--idempotency-key <key>', 'Make retries of this create safe')
  .action(
    action(async (options: { data: string; idempotencyKey?: string }) =>
      apiRequest(globals(), {
        method: 'POST',
        path: '/topics',
        body: parseData(options.data),
        idempotencyKey: options.idempotencyKey,
      })
    )
  )

topics
  .command('update')
  .description('Update a topic (channel is immutable)')
  .argument('<id>', 'Topic id')
  .requiredOption('--data <json>', 'Fields to change as JSON')
  .action(
    action(async (id: string, options: { data: string }) =>
      apiRequest(globals(), {
        method: 'PATCH',
        path: `/topics/${encodeURIComponent(id)}`,
        body: parseData(options.data),
      })
    )
  )

topics
  .command('delete')
  .description('Delete a topic')
  .argument('<id>', 'Topic id')
  .option('--force', 'Bypass the in-use check')
  .action(
    action(async (id: string, options: { force?: boolean }) =>
      apiRequest(globals(), {
        method: 'DELETE',
        path: `/topics/${encodeURIComponent(id)}`,
        query: options.force ? { force: true } : undefined,
      })
    )
  )

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

const imports = program.command('imports').description('Bulk-import records from a CSV file')

imports
  .command('create')
  .description('Start an import from an already-uploaded CSV file')
  .argument('<schema>', 'Contact or object schema id or slug')
  .requiredOption('--data <json>', 'JSON body ({fileUrl, byteSize, fileName?, defaultTags?, defaultSubscriptions?})')
  .option('--idempotency-key <key>', 'Make retries of this create safe')
  .action(
    action(async (schema: string, options: { data: string; idempotencyKey?: string }) =>
      apiRequest(globals(), {
        method: 'POST',
        path: `/schemas/${encodeURIComponent(schema)}/imports`,
        body: parseData(options.data),
        idempotencyKey: options.idempotencyKey,
      })
    )
  )

addListOptions(
  imports.command('list').description("List a schema's imports").argument('<schema>', 'Schema id or slug')
).action(
  action(async (schema: string, options: ListOptions) =>
    apiList(globals(), `/schemas/${encodeURIComponent(schema)}/imports`, options)
  )
)

imports
  .command('get')
  .description('Get an import by id')
  .argument('<id>', 'Import id')
  .action(
    action(async (id: string) => apiRequest(globals(), { method: 'GET', path: `/imports/${encodeURIComponent(id)}` }))
  )

imports
  .command('cancel')
  .description('Cancel a pending or running import')
  .argument('<id>', 'Import id')
  .action(
    action(async (id: string) =>
      apiRequest(globals(), { method: 'POST', path: `/imports/${encodeURIComponent(id)}/cancel` })
    )
  )

imports
  .command('download-failure-log')
  .description("Download an import's failure-row CSV to stdout")
  .argument('<id>', 'Import id')
  .action(async (id: string) => {
    try {
      const csv = await apiRequestText(globals(), {
        method: 'GET',
        path: `/imports/${encodeURIComponent(id)}/failure-log`,
      })
      process.stdout.write(csv.endsWith('\n') ? csv : `${csv}\n`)
    } catch (error) {
      fail(error)
    }
  })

// ---------------------------------------------------------------------------
// API keys
// ---------------------------------------------------------------------------

const apiKeys = program.command('api-keys').description('Self-service API key management (admin key)')

addListOptions(apiKeys.command('list').description('List API keys')).action(
  action(async (options: ListOptions) => apiList(globals(), '/api-keys', options))
)

apiKeys
  .command('create')
  .description('Create an API key (the plaintext key is returned once)')
  .option('--name <name>', 'Human-readable label')
  .action(
    action(async (options: { name?: string }) =>
      apiRequest(globals(), { method: 'POST', path: '/api-keys', body: { name: options.name ?? null } })
    )
  )

apiKeys
  .command('delete')
  .description('Delete an API key')
  .argument('<id>', 'API key id')
  .action(
    action(async (id: string) =>
      apiRequest(globals(), { method: 'DELETE', path: `/api-keys/${encodeURIComponent(id)}` })
    )
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
