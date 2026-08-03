#!/usr/bin/env node
import { Command } from 'commander';
import cron from 'node-cron';
import { loadConfig } from './config';
import { runSync } from './sync';

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
  .description('Run an immediate sync, then repeat on config.schedule (cron syntax)')
  .action(async () => {
    const config = loadConfig(program.opts().config);
    if (!config.schedule) {
      throw new Error('config.schedule (cron expression) is required to run in daemon mode');
    }
    const syncNow = () => runSync(config).catch((err) => console.error('Sync failed:', err));
    console.log(`Starting daemon with schedule "${config.schedule}"`);
    cron.schedule(config.schedule, syncNow);
    await syncNow();
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exit(1);
});
