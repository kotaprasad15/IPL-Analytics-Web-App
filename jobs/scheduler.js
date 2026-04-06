const { generateBets, lockExpiredBets } = require('../services/betService');
const { updateLiveMatches } = require('../services/matchService');

/**
 * 6. SCHEDULER / CRON JOBS
 * Background daemon that constantly keeps the game running.
 */
function startDaemon() {
  console.log('🚀 [Scheduler] Starting Fan Bets Daemon...');

  // 1. Live Match Score Polling
  // Updates real-time score dynamically every 15 seconds
  setInterval(async () => {
    try {
      await updateLiveMatches();
    } catch (err) {
      console.error('[Scheduler] matchService crash ignored:', err.message);
    }
  }, 15000);

  // 2. Bet Generation 
  // Runs every 10 seconds to generate "Who will win" or "Next Wicket" logic based on matches
  setInterval(async () => {
    try {
      await generateBets();
    } catch (err) {
      console.error('[Scheduler] betService generation crashed:', err.message);
    }
  }, 10000);

  // 3. Expired Bet Locking & Settle
  // Evaluates every 5 seconds if a bet has passed 'expires_at' and updates status to 'locked'
  // Settle is normally triggered tightly to Match events, but can run off polling intervals too.
  setInterval(async () => {
    try {
      await lockExpiredBets();
      // await settleBets() // Settle would usually be passed an outcome based on Match rules here
    } catch (err) {
      console.error('[Scheduler] lockExpiredBets crashed:', err.message);
    }
  }, 5000);
}

module.exports = {
  startDaemon
};
