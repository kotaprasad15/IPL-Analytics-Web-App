const { supabase } = require('../config/supabaseClient');

/**
 * 5. LIVE SCORE INTEGRATION
 * Fetches data from an external feed and updates the Matches table.
 * (Placeholder function representing fetching from IPL live API feed).
 */
async function updateLiveMatches() {
  // console.log('[matchService] Fetching live scores...');

  try {
    // Note: Replace this block with a real fetch(IPL_LIVE_URL)
    // For this example, we'll pretend we got a payload of active live matches.
    
    // 1. Get current matches we tracking as 'live'
    const { data: upcomingMatches, error } = await supabase
      .from('matches')
      .select('*')
      .in('status', ['upcoming', 'live']);

    if (error || !upcomingMatches) return;

    for (const match of upcomingMatches) {
      // Simulate live score changing
      if (match.status === 'live') {
        const simulatedScore = {
          teamA: "135/2",
          teamB: "0/0",
          overs: "14.2"
        };
        
        await supabase
          .from('matches')
          .update({ score: simulatedScore })
          .eq('id', match.id);
          
        // console.log(`[matchService] Updated score for ${match.id}`);
      }
    }
  } catch (err) {
    console.error('[matchService] Error updating live matches:', err.message);
  }
}

module.exports = {
  updateLiveMatches
};
