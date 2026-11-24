export const environment = {
    production: false,
    supabaseUrl: 'https://ainenjvhxtwgqfrjfyyy.supabase.co',
    supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFpbmVuanZoeHR3Z3FmcmpmeXl5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU3NDQzMDIsImV4cCI6MjA5MTMyMDMwMn0.7Lj8cTVgEZyGtQgW3SGt7BM9Woow1xOfBBc0Hs4Ywkw',
    /**
     * The GIF picker searches through this Supabase Edge Function (supabase/functions/giphy-search), which
     * keeps the GIPHY key as a secret (GIPHY_API_KEY): this file is in the public repository, and a key
     * the browser used directly would show in it too. So no giphyApiKey here.
     */
    giphyFunction: 'giphy-search',
};
