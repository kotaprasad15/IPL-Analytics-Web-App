require('dotenv').config();
const { startDaemon } = require('./jobs/scheduler');

// Basic Error Handling for unexpected server crashes
process.on('uncaughtException', (error) => {
  console.error('Fatal unhandled exception:', error);
});

console.log('--- IPL Analytics Fan Bets Backend ---');
console.log('Initializing Background Services...');

// Boot up the Scheduler Daemon
startDaemon();

console.log('Backend is running and listening to Supabase!');
