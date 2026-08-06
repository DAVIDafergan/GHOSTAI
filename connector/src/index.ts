#!/usr/bin/env node
import { Command } from 'commander';
import cron from 'node-cron';
import { loadConfig, resolveStateFilePath } from './config';
import { runSync } from './sync';
import { LocalStateStore } from './localState';
import { startServer } from './server';

const program = new Command();

program
  .name('pii-shield-connector')
  .description('Scans a configured data source and sends only entity hashes to the PII Shield backend')
  .requiredOption('-c, --config <path>', 'path to connector config JSON file');

program
  .command('sync')
  .description('Run a single sync now and exit')
  .action(async () => {
    const config = loadConfig(program.opts().config);
    const result = await runSync(config);
    console.log(`Sync complete: ${result.ingested} entities ingested (connector ${result.connectorId}).`);
  });

program
  .command('daemon')
  .description(
    'Run an immediate sync, then repeat on config.schedule (cron syntax). If config.apiPort is set, also starts the local sensitive-data API on that port.',
  )
  .action(async () => {
    const config = loadConfig(program.opts().config);
    if (!config.schedule) {
      throw new Error('config.schedule (cron expression) is required to run in daemon mode');
    }
    // Shared across scheduled syncs and the API server, so an exclude/
    // manual-add made through the API is picked up by the very next sync,
    // and a sync's freshly-seen entities are visible to the API immediately.
    const store = new LocalStateStore(resolveStateFilePath(config));
    const syncNow = () => runSync(config, console.log, store).catch((err) => console.error('Sync failed:', err));
    console.log(`Starting daemon with schedule "${config.schedule}"`);
    cron.schedule(config.schedule, syncNow);
    if (config.apiPort) {
      startServer(config, store, config.apiPort);
    }
    await syncNow();
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exit(1);
});
