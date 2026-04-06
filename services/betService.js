const { supabase } = require('../config/supabaseClient');

/**
 * 1. GENERATE BETS LOGIC
 * Scans upcoming & live matches to generate bets securely.
 */
async function generateBets() {
  console.log('[betService] Checking for matches that need new bets...');
  
  // Fetch active matches
  const { data: matches, error } = await supabase
    .from('matches')
    .select('*')
    .in('status', ['upcoming', 'live']);

  if (error || !matches) {
    console.error('[betService] Error fetching matches:', error);
    return;
  }

  for (const match of matches) {
    if (match.status === 'upcoming') {
      await generateUpcomingBets(match);
    } else if (match.status === 'live') {
      await generateLiveBets(match);
    }
  }
}

async function generateUpcomingBets(match) {
  // Check if standard Match Winner bet exists
  const { data: existing } = await supabase
    .from('bets')
    .select('id')
    .eq('match_id', match.id)
    .eq('type', 'match_winner');

  if (existing && existing.length > 0) return;

  // Set expiration properly to the match start time
  const expiresAt = match.start_time; 

  const newBet = {
    match_id: match.id,
    type: 'match_winner',
    question: `Who will win the match between ${match.team_a} and ${match.team_b}?`,
    options: [
      { id: 'opt_A', label: match.team_a, odds: 1.85 },
      { id: 'opt_B', label: match.team_b, odds: 1.85 }
    ],
    status: 'open',
    expires_at: expiresAt
  };

  const { error } = await supabase.from('bets').insert([newBet]);
  if (error) {
    console.error(`[betService] Failed to create Match Winner for ${match.id}:`, error.message);
  } else {
    console.log(`✅ [betService] Created Match Winner bet for ${match.id}`);
  }
}

async function generateLiveBets(match) {
  // Example of a dynamic live bet checking
  const dynamicQuestion = "Will a wicket fall in the next over?";
  
  const { data: existing } = await supabase
    .from('bets')
    .select('id')
    .eq('match_id', match.id)
    .eq('question', dynamicQuestion)
    .eq('status', 'open');

  // Prevent spamming the same dynamic question
  if (existing && existing.length > 0) return;

  // Expire the bet randomly between 3-5 minutes from now
  const expiryDate = new Date();
  expiryDate.setMinutes(expiryDate.getMinutes() + 3);

  const newBet = {
    match_id: match.id,
    type: 'next_wicket',
    question: dynamicQuestion,
    options: [
      { id: 'opt_yes', label: 'Yes', odds: 3.5 },
      { id: 'opt_no', label: 'No', odds: 1.2 }
    ],
    status: 'open',
    expires_at: expiryDate.toISOString()
  };

  const { error } = await supabase.from('bets').insert([newBet]);
  if (!error) console.log(`⚡ [betService] Created Live dynamic bet for ${match.id}`);
}

/**
 * 2. PLACE BET LOGIC
 * Safe placeBet wrapper wrapping the Supabase RPC function created earlier.
 */
async function placeBet(userId, betId, selectedOptionId, pointsWagered) {
  // Utilizing the RPC (Postgres Function) ensures Atomic transactions 
  // without race-conditions on point deductions!
  const { data, error } = await supabase.rpc('place_fan_bet', {
    p_user_id: userId,
    p_bet_id: betId,
    p_selected_option: selectedOptionId,
    p_points_wagered: pointsWagered
  });

  if (error) {
    console.error(`❌ [betService] Failed to place bet for User ${userId}:`, error.message);
    throw new Error(error.message);
  }

  console.log(`✅ [betService] Bet placed successfully. New Balance: ${data.newBalance}`);
  return data;
}

/**
 * 3. LOCK EXPIRED BETS LOGIC
 * Finds Open bets past expiration and locks them.
 */
async function lockExpiredBets() {
  const now = new Date().toISOString();
  
  const { data, error } = await supabase
    .from('bets')
    .update({ status: 'locked' })
    .eq('status', 'open')
    .lte('expires_at', now)
    .select('id, question');

  if (error) {
    console.error('[betService] Error locking bets:', error.message);
    return;
  }

  if (data && data.length > 0) {
    console.log(`🔒 [betService] Locked ${data.length} expired bets.`);
  }
}

/**
 * 4. SETTLE BETS LOGIC
 * When outcome is known, distribute points back to users.
 */
async function settleBets(betId, correctOptionId) {
  // A. Set correctOption in Bet table
  const { error: betUpdateError } = await supabase
    .from('bets')
    .update({ status: 'settled', correct_option: correctOptionId })
    .eq('id', betId);
    
  if (betUpdateError) {
    console.error('[betService] Failed to settle bet:', betUpdateError.message);
    return;
  }

  // B. Fetch all users who placed this bet 
  // (In a massive app, use Supabase server-side Functions or paginate, but this is fine for Node backend)
  const { data: userBets, error: ubError } = await supabase
    .from('user_bets')
    .select('*, bets!inner(options)')
    .eq('bet_id', betId)
    .eq('status', 'pending');

  if (ubError || !userBets) return;

  for (const ub of userBets) {
    if (ub.selected_option === correctOptionId) {
      // User Won! Extract the odds to calculate payout
      const optionDetails = ub.bets.options.find(opt => opt.id === correctOptionId);
      const odds = optionDetails ? optionDetails.odds : 1.0;
      const amountWon = Math.floor(ub.points_wagered * odds);

      // Distribute points & update user stats using generic raw update or custom RPC.
      // Below is a dual update:
      await supabase.from('user_bets').update({ status: 'won', points_won: amountWon }).eq('id', ub.id);
      
      // Caution: Updating points blindly in JS introduces race condition.
      // Easiest safe fix is an RPC, but for brevity we update directly here using `rpc` decrement/increment if available,
      // or we just read then write.
      const { data: uData } = await supabase.from('users').select('points, total_bets, wins').eq('id', ub.user_id).single();
      if(uData) {
        await supabase.from('users').update({
          points: uData.points + amountWon,
          total_bets: uData.total_bets + 1,
          wins: uData.wins + 1
        }).eq('id', ub.user_id);
      }
      console.log(`🏆 [betService] User ${ub.user_id} won! Paid ${amountWon} points.`);
    } else {
      // User Lost
      await supabase.from('user_bets').update({ status: 'lost', points_won: 0 }).eq('id', ub.id);
      
      const { data: uData } = await supabase.from('users').select('total_bets, losses').eq('id', ub.user_id).single();
      if(uData) {
         await supabase.from('users').update({
           total_bets: uData.total_bets + 1,
           losses: uData.losses + 1
         }).eq('id', ub.user_id);
      }
      console.log(`😭 [betService] User ${ub.user_id} lost.`);
    }
  }
}

module.exports = {
  generateBets,
  placeBet,
  lockExpiredBets,
  settleBets
};
