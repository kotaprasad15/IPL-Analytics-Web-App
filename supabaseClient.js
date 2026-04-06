(function bootstrapSupabaseClient() {
  const supabaseUrl = "https://krmotrcelcckwbsibwfk.supabase.co";
  const supabaseAnonKey = "sb_publishable_hCeQ97grlZWO7hrR7VnM0g_OoU7Cztf";

  if (!window.supabase?.createClient) {
    console.error("Supabase SDK is not available in the browser.");
    return;
  }

  window.supabaseClient = window.supabase.createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
    },
  });

  window.supabaseConfig = {
    supabaseUrl,
    supabaseAnonKey,
  };
})();
