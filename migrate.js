import { createClient } from '@supabase/supabase-js';
import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing Supabase credentials in .env");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const db = new Low(new JSONFile(new URL('./db.json', import.meta.url).pathname), { users: [], positions: [] });

async function migrate() {
  await db.read();
  
  const users = db.data.users || [];
  const positions = db.data.positions || [];

  console.log(`Found ${users.length} users and ${positions.length} positions in db.json`);

  if (users.length > 0) {
    const { error } = await supabase.from('users').upsert(users);
    if (error) console.error("Error migrating users:", error.message);
    else console.log("Users migrated successfully.");
  }

  if (positions.length > 0) {
    const { error } = await supabase.from('positions').upsert(positions);
    if (error) console.error("Error migrating positions:", error.message);
    else console.log("Positions migrated successfully.");
  }
}

migrate();
