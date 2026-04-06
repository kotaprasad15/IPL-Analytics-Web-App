const { supabase } = require('./config/supabaseClient');

async function testConnection() {
  console.log('Testing Supabase connection...');
  
  // Try to fetch matches to ensure the connection works
  const { data, error } = await supabase.from('matches').select('*').limit(3);
  
  if (error) {
    console.error('❌ Error testing connection. Did you run the SQL script in your dashboard?:');
    console.error(error.message);
  } else {
    console.log('✅ Connection successful!');
    console.log('Matches currently in database:', data);
    
    // If the database is empty, let's insert a test match!
    if (data.length === 0) {
      console.log('Inserting a test match...');
      const testMatch = {
        id: 'test_match_1',
        team_a: 'CSK',
        team_b: 'MI',
        status: 'upcoming',
        score: { "teamA": "0/0", "teamB": "0/0", "overs": "0.0" },
        start_time: new Date().toISOString()
      };
      
      const { data: insertedMatch, error: insertError } = await supabase
        .from('matches')
        .insert([testMatch])
        .select();
        
      if (insertError) {
        console.error('❌ Insert failed:', insertError.message);
      } else {
        console.log('✅ Successfully inserted a test match:', insertedMatch);
      }
    }
  }
}

testConnection();
