import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://xbymabfsrhqhgctyidju.supabase.co'
const supabaseKey = 'sb_publishable_rUdYgCevXg6FWfiXNFT9Mw_lYE63_Ia'
const supabase = createClient(supabaseUrl, supabaseKey)

async function test() {
  const { data, error } = await supabase.from('positions').select('*').limit(1)
  console.log('positions:', data, error)
}
test()
