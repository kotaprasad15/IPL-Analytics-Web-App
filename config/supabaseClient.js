require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// These should be set in your .env file
const supabaseUrl = process.env.SUPABASE_URL || 'https://krmotrcelcckwbsibwfk.supabase.co';
const supabaseKey = process.env.SUPABASE_ANON_KEY || 'sb_publishable_hCeQ97grlZWO7hrR7VnM0g_OoU7Cztf';

// If you need admin privileges in your Node.js backend (e.g., to manage users), 
// use the Service Role key instead of the anonymous key.
// NEVER expose the Service Role key to the frontend!
// const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
// const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey);

// Initialize the standard Supabase client
const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = {
  supabase,
  // supabaseAdmin
};
